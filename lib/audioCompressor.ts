import { Mp3Encoder } from '@breezystack/lamejs'

/**
 * Automatically converts & compresses audio files starting from 10MB
 * into optimized lightweight MP3 files.
 * 
 * Compression runs inside a Web Worker to avoid blocking the main thread.
 * Falls back to main thread encoding if Worker fails.
 */
export async function compressAudioIfNeeded(
  file: File,
  onProgress?: (progressPercent: number, stageText?: string) => void,
  targetBitrate: number = 256,
  minCompressSizeMB: number = 10
): Promise<{ file: File; compressed: boolean; originalSizeMB: number; newSizeMB: number }> {
  const originalSizeMB = Number((file.size / (1024 * 1024)).toFixed(2))

  // If file size is under threshold, no compression needed
  if (file.size < minCompressSizeMB * 1024 * 1024) {
    return { file, compressed: false, originalSizeMB, newSizeMB: originalSizeMB }
  }

  try {
    if (onProgress) onProgress(5, `Đang đọc dữ liệu file (${originalSizeMB} MB)...`)

    // 1. Read & decode audio on main thread (fast, no blocking)
    const arrayBuffer = await file.arrayBuffer()
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    const audioCtx = new AudioContextClass()

    if (onProgress) onProgress(20, 'Đang giải mã âm thanh AudioBuffer...')

    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0))
    audioCtx.close()

    if (onProgress) onProgress(35, `Đang tối ưu dung lượng (${targetBitrate}kbps MP3)...`)

    // 2. Extract PCM channel data
    const numChannels = Math.min(2, audioBuffer.numberOfChannels || 1)
    const length = audioBuffer.length

    // Standardize sample rate for LAME encoder
    let sampleRate = audioBuffer.sampleRate
    if (sampleRate > 48000 || ![44100, 48000, 32000, 24000, 22050, 16000, 11025, 8000].includes(sampleRate)) {
      sampleRate = 44100
    }

    const left = audioBuffer.getChannelData(0)
    const right = numChannels > 1 ? audioBuffer.getChannelData(1) : left

    // Convert Float32 → Int16
    const leftInt16 = new Int16Array(length)
    const rightInt16 = new Int16Array(length)
    for (let i = 0; i < length; i++) {
      const l = Math.max(-1, Math.min(1, left[i]))
      leftInt16[i] = l < 0 ? l * 0x8000 : l * 0x7fff
      const r = Math.max(-1, Math.min(1, right[i]))
      rightInt16[i] = r < 0 ? r * 0x8000 : r * 0x7fff
    }

    if (onProgress) onProgress(50, `Đang nén & chuyển sang MP3 (${targetBitrate}kbps) — đang chạy Worker...`)

    // 3. Run MP3 encoding inside Web Worker (off main thread → no lag)
    const mp3Data = await encodeInWorker(leftInt16, rightInt16, numChannels, sampleRate, targetBitrate, onProgress)

    if (onProgress) onProgress(98, 'Đang hoàn tất tạo file MP3 mới...')

    // 4. Build result File
    const blob = new Blob(mp3Data as BlobPart[], { type: 'audio/mp3' })
    const baseName = file.name.replace(/\.[^/.]+$/, '')
    const compressedFile = new File([blob], `${baseName}_light.mp3`, {
      type: 'audio/mp3',
      lastModified: Date.now(),
    })

    const newSizeMB = Number((compressedFile.size / (1024 * 1024)).toFixed(2))
    if (onProgress) onProgress(100, `Hoàn tất (${originalSizeMB} MB ➔ ${newSizeMB} MB)!`)

    return { file: compressedFile, compressed: true, originalSizeMB, newSizeMB }
  } catch (err: any) {
    console.error('Audio compression failed:', err)
    // Fallback: return original file so upload doesn't crash
    return { file, compressed: false, originalSizeMB, newSizeMB: originalSizeMB }
  }
}

/**
 * Offloads the heavy LAME MP3 encoding loop to a Web Worker.
 * Falls back to main-thread encoding if Worker is unavailable.
 */
function encodeInWorker(
  leftInt16: Int16Array,
  rightInt16: Int16Array,
  numChannels: number,
  sampleRate: number,
  targetBitrate: number,
  onProgress?: (pct: number, text?: string) => void
): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    // Web Workers require an absolute URL — /audioWorker.js is served from /public
    let worker: Worker | null = null
    try {
      worker = new Worker('/audioWorker.js')
    } catch {
      // Worker failed to initialize — fall back to main thread
      return resolve(encodeOnMainThread(leftInt16, rightInt16, numChannels, sampleRate, targetBitrate, onProgress))
    }

    worker.onmessage = (e) => {
      const { type, pct, mp3Data, message } = e.data
      if (type === 'progress' && onProgress) {
        onProgress(pct, `Đang nén MP3 (${pct}%) — Worker...`)
      } else if (type === 'done') {
        worker!.terminate()
        resolve(mp3Data as Uint8Array[])
      } else if (type === 'error') {
        worker!.terminate()
        // Fall back to main thread on worker error
        console.warn('Worker encoding failed, falling back to main thread:', message)
        resolve(encodeOnMainThread(leftInt16, rightInt16, numChannels, sampleRate, targetBitrate, onProgress))
      }
    }

    worker.onerror = (err) => {
      worker!.terminate()
      console.warn('Worker error, falling back to main thread:', err)
      resolve(encodeOnMainThread(leftInt16, rightInt16, numChannels, sampleRate, targetBitrate, onProgress))
    }

    // Transfer typed arrays to worker (zero-copy via Transferable)
    worker.postMessage(
      { leftInt16, rightInt16, numChannels, sampleRate, targetBitrate },
      [leftInt16.buffer, rightInt16.buffer]
    )
  })
}

/** Fallback: encode MP3 on main thread (blocks UI, but better than crashing) */
function encodeOnMainThread(
  leftInt16: Int16Array,
  rightInt16: Int16Array,
  numChannels: number,
  sampleRate: number,
  targetBitrate: number,
  onProgress?: (pct: number, text?: string) => void
): Uint8Array[] {
  const mp3encoder = new Mp3Encoder(numChannels, sampleRate, targetBitrate)
  const mp3Data: Uint8Array[] = []
  const length = leftInt16.length
  const sampleBlockSize = 1152

  for (let i = 0; i < length; i += sampleBlockSize) {
    const leftChunk = leftInt16.subarray(i, i + sampleBlockSize)
    const rightChunk = rightInt16.subarray(i, i + sampleBlockSize)

    let mp3buf: Int8Array | Uint8Array
    if (numChannels > 1) {
      mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk)
    } else {
      mp3buf = mp3encoder.encodeBuffer(leftChunk)
    }
    if (mp3buf && mp3buf.length > 0) mp3Data.push(new Uint8Array(mp3buf))

    if (onProgress && i % (sampleBlockSize * 150) === 0) {
      const pct = Math.min(95, 50 + Math.round((i / length) * 45))
      onProgress(pct, `Đang nén MP3 (${pct}%)...`)
    }
  }

  const endBuf = mp3encoder.flush()
  if (endBuf && endBuf.length > 0) mp3Data.push(new Uint8Array(endBuf))

  return mp3Data
}
