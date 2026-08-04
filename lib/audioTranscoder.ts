import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let ffmpegPromise: Promise<FFmpeg> | null = null

async function getFFmpeg() {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg()
      const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'
      await ffmpeg.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
      })
      return ffmpeg
    })()
    ffmpegPromise.catch(() => {
      ffmpegPromise = null
    })
  }
  return ffmpegPromise
}

export async function transcodeToM4a(
  file: File,
  onProgress?: (percent: number, message: string) => void,
): Promise<File> {
  if (typeof window === 'undefined') throw new Error('Audio conversion must run in the browser')

  const ffmpeg = await getFFmpeg()
  const inputName = `input-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const outputName = `${inputName}.m4a`

  const handleProgress = ({ progress }: { progress: number }) => {
    onProgress?.(Math.min(99, Math.max(1, Math.round(progress * 100))), 'Đang chuyển sang M4A/AAC 320kbps...')
  }
  ffmpeg.on('progress', handleProgress)

  try {
    onProgress?.(1, 'Đang tải bộ chuyển đổi audio...')
    await ffmpeg.writeFile(inputName, await fetchFile(file))
    await ffmpeg.exec([
      '-i', inputName,
      '-vn',
      '-c:a', 'aac',
      '-b:a', '320k',
      '-movflags', '+faststart',
      outputName,
    ])
    const output = await ffmpeg.readFile(outputName)
    const bytes = typeof output === 'string' ? new TextEncoder().encode(output) : output
    const outputBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    onProgress?.(100, 'Đã tạo M4A/AAC 320kbps')
    return new File([outputBuffer], `${file.name.replace(/\.[^/.]+$/, '')}.m4a`, {
      type: 'audio/mp4',
      lastModified: Date.now(),
    })
  } finally {
    ffmpeg.off('progress', handleProgress)
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}
