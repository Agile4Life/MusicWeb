/**
 * audioWorker.js — runs in a Web Worker (off main thread)
 * Loads lamejs from local static asset, encodes PCM audio data to MP3, reports progress.
 */

// Load lamejs encoder locally (first try local static file, fallback to CDN if needed)
try {
  importScripts('/lame.all.js')
} catch (e1) {
  try {
    importScripts('/lame.min.js')
  } catch (e2) {
    try {
      importScripts('https://cdn.jsdelivr.net/npm/@breezystack/lamejs@2.2.0/src/lame.all.js')
    } catch (e3) {
      console.error('Worker failed to load lamejs script:', e3)
    }
  }
}

self.onmessage = function (e) {
  const { leftInt16, rightInt16, numChannels, sampleRate, targetBitrate } = e.data

  try {
    const encoderClass = typeof lamejs !== 'undefined' ? lamejs.Mp3Encoder : (self.lamejs ? self.lamejs.Mp3Encoder : null)
    if (!encoderClass) {
      throw new Error('LAME MP3 Encoder library could not be initialized in worker')
    }

    const length = leftInt16.length
    const mp3encoder = new encoderClass(numChannels, sampleRate, targetBitrate)
    const mp3Data = []
    const sampleBlockSize = 1152

    for (let i = 0; i < length; i += sampleBlockSize) {
      const leftChunk = leftInt16.subarray(i, i + sampleBlockSize)
      const rightChunk = rightInt16.subarray(i, i + sampleBlockSize)

      let mp3buf
      if (numChannels > 1) {
        mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk)
      } else {
        mp3buf = mp3encoder.encodeBuffer(leftChunk)
      }

      if (mp3buf && mp3buf.length > 0) {
        mp3Data.push(new Uint8Array(mp3buf))
      }

      // Report progress every ~150 blocks
      if (i % (sampleBlockSize * 150) === 0) {
        const pct = Math.min(95, 50 + Math.round((i / length) * 45))
        self.postMessage({ type: 'progress', pct })
      }
    }

    const endBuf = mp3encoder.flush()
    if (endBuf && endBuf.length > 0) {
      mp3Data.push(new Uint8Array(endBuf))
    }

    self.postMessage({ type: 'done', mp3Data })
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || 'Worker encoding failed' })
  }
}
