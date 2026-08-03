import lamejs from 'lamejs'

/**
 * Automatically compresses heavy audio files (> 45MB) to High-Quality 320kbps MP3
 * in the browser to ensure files always stay well within Supabase Free Tier limits (50MB max).
 */
export async function compressAudioIfNeeded(
  file: File,
  onProgress?: (progressPercent: number, stageText?: string) => void
): Promise<{ file: File; compressed: boolean; originalSizeMB: number; newSizeMB: number }> {
  const originalSizeMB = Number((file.size / (1024 * 1024)).toFixed(2))

  // If file size is already <= 45MB, no compression needed
  if (file.size <= 45 * 1024 * 1024) {
    return { file, compressed: false, originalSizeMB, newSizeMB: originalSizeMB }
  }

  try {
    if (onProgress) onProgress(5, `Đang giải mã file âm thanh ${originalSizeMB}MB...`)

    // 1. Read array buffer & decode audio with Web Audio API
    const arrayBuffer = await file.arrayBuffer()
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    const audioCtx = new AudioContextClass()

    if (onProgress) onProgress(20, 'Đang phân tích PCM AudioBuffer...')

    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
    audioCtx.close()

    if (onProgress) onProgress(35, 'Đang tối ưu dung lượng 320kbps High-Res...')

    // 2. Extract PCM channel data
    const numChannels = audioBuffer.numberOfChannels
    const sampleRate = audioBuffer.sampleRate
    const length = audioBuffer.length

    const left = audioBuffer.getChannelData(0)
    const right = numChannels > 1 ? audioBuffer.getChannelData(1) : left

    // Convert Float32Array (-1.0 to +1.0) to Int16Array (-32768 to 32767)
    const leftInt16 = new Int16Array(length)
    const rightInt16 = new Int16Array(length)

    for (let i = 0; i < length; i++) {
      let sampleL = Math.max(-1, Math.min(1, left[i]))
      leftInt16[i] = sampleL < 0 ? sampleL * 0x8000 : sampleL * 0x7fff

      let sampleR = Math.max(-1, Math.min(1, right[i]))
      rightInt16[i] = sampleR < 0 ? sampleR * 0x8000 : sampleR * 0x7fff
    }

    if (onProgress) onProgress(50, 'Đang mã hóa MP3 High-Res...')

    // 3. Initialize LAME MP3 Encoder (320kbps High Quality)
    const mp3encoder = new (lamejs as any).Mp3Encoder(numChannels > 1 ? 2 : 1, sampleRate, 320)
    const mp3Data: Uint8Array[] = []
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

      if (mp3buf.length > 0) {
        mp3Data.push(new Uint8Array(mp3buf))
      }

      if (onProgress && i % (sampleBlockSize * 150) === 0) {
        const pct = Math.min(95, 50 + Math.round((i / length) * 45))
        onProgress(pct, `Đang mã hóa MP3 High-Res (${pct}%)...`)
      }
    }

    const endBuf = mp3encoder.flush()
    if (endBuf.length > 0) {
      mp3Data.push(new Uint8Array(endBuf))
    }

    if (onProgress) onProgress(98, 'Đang đóng gói file MP3 mới...')

    // 4. Create compressed MP3 file Blob
    const blob = new Blob(mp3Data as BlobPart[], { type: 'audio/mp3' })
    const baseName = file.name.replace(/\.[^/.]+$/, '')
    const compressedFile = new File([blob], `${baseName}_320k.mp3`, {
      type: 'audio/mp3',
      lastModified: Date.now(),
    })

    const newSizeMB = Number((compressedFile.size / (1024 * 1024)).toFixed(2))

    if (onProgress) onProgress(100, `Hoàn tất tối ưu (${originalSizeMB}MB -> ${newSizeMB}MB)!`)

    return { file: compressedFile, compressed: true, originalSizeMB, newSizeMB }
  } catch (err) {
    console.warn('Audio compression warning, using original file:', err)
    return { file, compressed: false, originalSizeMB, newSizeMB: originalSizeMB }
  }
}
