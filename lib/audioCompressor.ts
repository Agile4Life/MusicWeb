import { Mp3Encoder } from '@breezystack/lamejs'

/**
 * Automatically converts & compresses ALL audio files (WAV, FLAC, M4A, MP3) 
 * into optimized lightweight MP3 files regardless of initial size to save storage and bandwidth.
 */
export async function compressAudioIfNeeded(
  file: File,
  onProgress?: (progressPercent: number, stageText?: string) => void,
  targetBitrate: number = 256,
  forceCompress: boolean = true
): Promise<{ file: File; compressed: boolean; originalSizeMB: number; newSizeMB: number }> {
  const originalSizeMB = Number((file.size / (1024 * 1024)).toFixed(2))

  // If already a small MP3 (< 3MB) and forceCompress is false, we can skip
  if (!forceCompress && file.size <= 3 * 1024 * 1024 && file.type.includes('mp3')) {
    return { file, compressed: false, originalSizeMB, newSizeMB: originalSizeMB }
  }

  try {
    if (onProgress) onProgress(5, `Đang đọc dữ liệu file (${originalSizeMB} MB)...`)

    // 1. Read array buffer & decode audio with Web Audio API (slice buffer to prevent detachment)
    const arrayBuffer = await file.arrayBuffer()
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    const audioCtx = new AudioContextClass()

    if (onProgress) onProgress(20, 'Đang giải mã âm thanh AudioBuffer...')

    // Pass arrayBuffer.slice(0) to prevent ArrayBuffer detachment issues
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0))
    audioCtx.close()

    if (onProgress) onProgress(35, `Đang tối ưu dung lượng (${targetBitrate}kbps MP3)...`)

    // 2. Extract PCM channel data
    const numChannels = Math.min(2, audioBuffer.numberOfChannels || 1)
    const sampleRate = audioBuffer.sampleRate
    const length = audioBuffer.length

    // Standardize sample rate for MP3 LAME encoder (LAME requires 44.1kHz or 48kHz max)
    let targetSampleRate = sampleRate
    if (targetSampleRate > 48000 || ![44100, 48000, 32000, 24000, 22050, 16000, 11025, 8000].includes(targetSampleRate)) {
      targetSampleRate = 44100
    }

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

    if (onProgress) onProgress(50, `Đang nén & chuyển sang MP3 (${targetBitrate}kbps)...`)

    // 3. Initialize LAME MP3 Encoder
    const mp3encoder = new Mp3Encoder(numChannels, targetSampleRate, targetBitrate)
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

      if (mp3buf && mp3buf.length > 0) {
        mp3Data.push(new Uint8Array(mp3buf))
      }

      if (onProgress && i % (sampleBlockSize * 150) === 0) {
        const pct = Math.min(95, 50 + Math.round((i / length) * 45))
        onProgress(pct, `Đang nén file MP3 nhẹ (${pct}%)...`)
      }
    }

    const endBuf = mp3encoder.flush()
    if (endBuf && endBuf.length > 0) {
      mp3Data.push(new Uint8Array(endBuf))
    }

    if (onProgress) onProgress(98, 'Đang hoàn tất tạo file MP3 mới...')

    // 4. Create compressed MP3 file Blob
    const blob = new Blob(mp3Data as BlobPart[], { type: 'audio/mp3' })
    const baseName = file.name.replace(/\.[^/.]+$/, '')
    const compressedFile = new File([blob], `${baseName}_light.mp3`, {
      type: 'audio/mp3',
      lastModified: Date.now(),
    })

    const newSizeMB = Number((compressedFile.size / (1024 * 1024)).toFixed(2))

    if (onProgress) onProgress(100, `Hoàn tất tối ưu dung lượng (${originalSizeMB} MB ➔ ${newSizeMB} MB)!`)

    return { file: compressedFile, compressed: true, originalSizeMB, newSizeMB }
  } catch (err: any) {
    console.error('Audio compression failed:', err)
    // Fallback: If compression fails for any reason, return original file so upload doesn't crash
    return { file, compressed: false, originalSizeMB, newSizeMB: originalSizeMB }
  }
}

