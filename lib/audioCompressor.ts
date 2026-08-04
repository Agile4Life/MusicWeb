import { Mp3Encoder } from 'lamejs'

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

  // Keep formats that browsers reliably play untouched. In particular, AAC
  // 320kbps must not be transcoded to MP3 because that would add another
  // lossy compression step. FLAC/WAV fall through to the existing MP3
  // encoder below, which runs in a dedicated Web Worker.
  const extension = file.name.split('.').pop()?.toLowerCase()
  const nativeFormats = new Set(['aac', 'm4a', 'mp3', 'ogg', 'oga', 'opus'])
  if (extension && nativeFormats.has(extension)) {
    return { file, compressed: false, originalSizeMB, newSizeMB: originalSizeMB }
  }

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
    const sampleRate = audioBuffer.sampleRate

    const left = audioBuffer.getChannelData(0)
    const right = numChannels > 1 ? audioBuffer.getChannelData(1) : left

    // Convert Float32 → Int16
    const { leftInt16, rightInt16 } = await convertPcmCooperatively(left, right, onProgress)

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

    if (compressedFile.size === 0) {
      throw new Error('Bộ mã hóa MP3 tạo file 0 byte')
    }

    const newSizeMB = Number((compressedFile.size / (1024 * 1024)).toFixed(2))
    if (onProgress) onProgress(100, `Hoàn tất (${originalSizeMB} MB ➔ ${newSizeMB} MB)!`)

    return { file: compressedFile, compressed: true, originalSizeMB, newSizeMB }
  } catch (err: any) {
    console.error('Audio compression failed:', err)
    // Never upload an unplayable source format after a failed conversion.
    throw new Error(err?.message || 'Không thể chuyển file audio sang MP3 để phát trên web')
  }
}

/** Converts Float32 channel data to Int16 cooperatively without blocking the main UI thread */
async function convertPcmCooperatively(
  left: Float32Array,
  right: Float32Array,
  onProgress?: (pct: number, text?: string) => void
): Promise<{ leftInt16: Int16Array; rightInt16: Int16Array }> {
  const length = left.length
  const leftInt16 = new Int16Array(length)
  const rightInt16 = new Int16Array(length)
  const chunkSize = 100000

  for (let i = 0; i < length; i += chunkSize) {
    const end = Math.min(i + chunkSize, length)
    for (let j = i; j < end; j++) {
      const sL = Math.max(-1, Math.min(1, left[j]))
      leftInt16[j] = sL < 0 ? sL * 0x8000 : sL * 0x7fff
      const sR = Math.max(-1, Math.min(1, right[j]))
      rightInt16[j] = sR < 0 ? sR * 0x8000 : sR * 0x7fff
    }
    if (i % (chunkSize * 5) === 0) {
      if (onProgress) {
        const pct = 35 + Math.round((i / length) * 15)
        onProgress(pct, `Đang xử lý PCM âm thanh (${pct}%)...`)
      }
      await new Promise((res) => setTimeout(res, 0))
    }
  }

  return { leftInt16, rightInt16 }
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
  return new Promise((resolve) => {
    const fallbackLeft = leftInt16.slice(0)
    const fallbackRight = rightInt16.slice(0)
    let worker: Worker | null = null

    try {
      worker = new Worker('/audioWorker.js?v=4')
    } catch (error) {
      return resolve(encodeOnMainThread(fallbackLeft, fallbackRight, numChannels, sampleRate, targetBitrate, onProgress))
    }

    // Safety timeout: if Worker hangs > 45s without finishing, fallback to main thread
    const timeoutId = setTimeout(() => {
      if (worker) {
        console.warn('Worker encoding timed out, falling back to main thread')
        try { worker.terminate() } catch {}
        resolve(encodeOnMainThread(fallbackLeft, fallbackRight, numChannels, sampleRate, targetBitrate, onProgress))
      }
    }, 45000)

    let lastReportedPct = -1
    worker.onmessage = (e) => {
      const { type, pct, mp3Data, message } = e.data
      if (type === 'progress' && onProgress) {
        if (pct - lastReportedPct >= 2 || pct >= 98) {
          lastReportedPct = pct
          onProgress(pct, `Đang nén MP3 (${pct}%)...`)
        }
      } else if (type === 'done') {
        clearTimeout(timeoutId)
        worker!.terminate()
        resolve(mp3Data as Uint8Array[])
      } else if (type === 'error') {
        clearTimeout(timeoutId)
        worker!.terminate()
        console.warn('Worker encoding failed, falling back to main thread:', message)
        resolve(encodeOnMainThread(fallbackLeft, fallbackRight, numChannels, sampleRate, targetBitrate, onProgress))
      }
    }

    worker.onerror = (err) => {
      clearTimeout(timeoutId)
      worker!.terminate()
      console.warn('Worker error, falling back to main thread:', err)
      resolve(encodeOnMainThread(fallbackLeft, fallbackRight, numChannels, sampleRate, targetBitrate, onProgress))
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
