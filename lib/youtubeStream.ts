import dns from 'dns'
import ytdl from '@distube/ytdl-core'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import { firstValidResult } from './firstValidResult'

try {
  dns.setDefaultResultOrder('ipv4first')
} catch {}

const execFileAsync = promisify(execFile)

export interface ResolvedYouTubeStream {
  url: string
  mimeType: string
}

export const streamUrlCache = new Map<string, { url: string; mimeType: string; expiresAt: number }>()
const STREAM_CACHE_TTL = 2.5 * 60 * 60 * 1000 // googlevideo URLs expire after ~6h

export async function resolveYouTubeAudioStreamCached(videoId: string): Promise<ResolvedYouTubeStream | null> {
  const cached = streamUrlCache.get(videoId)
  if (cached && Date.now() < cached.expiresAt) {
    return { url: cached.url, mimeType: cached.mimeType }
  }

  const resolved = await resolveYouTubeAudioStream(videoId)
  if (resolved && resolved.url) {
    streamUrlCache.set(videoId, { ...resolved, expiresAt: Date.now() + STREAM_CACHE_TTL })
  }
  return resolved
}

function findYtDlpBinary(): string | null {
  const candidates = [
    process.env.YTDLP_PATH,
    path.join(process.cwd(), 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
    'yt-dlp',
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (candidate === 'yt-dlp' || fs.existsSync(candidate)) return candidate
  }
  return null
}

async function resolveViaYtDlp(videoId: string): Promise<ResolvedYouTubeStream | null> {
  const binary = findYtDlpBinary()
  if (!binary) return null

  try {
    const { stdout } = await execFileAsync(
      binary,
      [
        '--get-url',
        '--no-playlist',
        '--no-warnings',
        '--socket-timeout',
        '15',
        '-f',
        'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio',
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { timeout: 25000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }
    )

    const url = stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith('http'))
    if (!url) return null

    let mimeType = ''
    if (/\.(m4a|mp4)(\?|$)/.test(url)) mimeType = 'audio/mp4'
    else if (/\.(webm|opus)(\?|$)/.test(url)) mimeType = 'audio/webm'

    return { url, mimeType }
  } catch (err: any) {
    console.warn('yt-dlp stream resolution warning:', err?.message || err)
    return null
  }
}

export async function resolveYouTubeAudioStreamAndroid(videoId: string): Promise<ResolvedYouTubeStream | null> {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
            androidSdkVersion: 34,
          },
        },
        videoId: videoId,
      }),
      signal: AbortSignal.timeout(4500),
    })

    if (res.ok) {
      const data = await res.json()
      const streamingData = data.streamingData || {}
      const formats = [...(streamingData.formats || []), ...(streamingData.adaptiveFormats || [])]
      const audioOnly = formats.filter((f: any) => f.mimeType && f.mimeType.includes('audio'))

      if (audioOnly.length > 0) {
        const bestAudio =
          audioOnly.find((f: any) => f.url && f.mimeType.includes('audio/mp4')) ||
          audioOnly.find((f: any) => f.url)

        if (bestAudio && bestAudio.url) {
          return {
            url: bestAudio.url,
            mimeType: bestAudio.mimeType || 'audio/mp4',
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('InnerTube ANDROID stream resolution warning:', err?.message || err)
  }
  return null
}

export async function resolveYouTubeAudioStream(videoId: string): Promise<ResolvedYouTubeStream | null> {
  if (!videoId) return null

  const ytDlpStream = await resolveViaYtDlp(videoId)
  if (ytDlpStream) return ytDlpStream

  const androidStream = await resolveYouTubeAudioStreamAndroid(videoId)
  if (androidStream) return androidStream

  try {
    // Bound ytdl-core with an 8-second timeout — it has no built-in timeout and can hang
    // indefinitely on slow/inaccessible videos.
    const info = await Promise.race([
      ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`, {
        requestOptions: {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('ytdl-core timeout (8s)')), 8000)
      ),
    ])
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly')
    if (audioFormats && audioFormats.length > 0) {
      const m4aFormat = audioFormats.find((f) => f.mimeType && f.mimeType.includes('audio/mp4')) || audioFormats[0]
      if (m4aFormat && m4aFormat.url) {
        return {
          url: m4aFormat.url,
          mimeType: m4aFormat.mimeType || 'audio/mp4',
        }
      }
    }
  } catch (err: any) {
    console.warn('ytdl-core stream resolution warning:', err?.message || err)
  }

  // Run all Piped instances in parallel — first successful response wins.
  // Total worst-case latency: max(3.5s) instead of sequential 4 × 3.5s = 14s.
  const pipedInstances = [
    'https://pipedapi.mha.fi/streams/',
    'https://pipedapi.adminforge.de/streams/',
    'https://pipedapi.kavin.rocks/streams/',
    'https://api.piped.video/streams/',
  ]

  const pipedStream = await firstValidResult(
    pipedInstances.map((base) => async () => {
      const res = await fetch(`${base}${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(3500),
      })
      if (!res.ok) throw new Error(`Piped ${base} responded ${res.status}`)
      const data = await res.json()
      const audioStreams = data.audioStreams || []
      if (!audioStreams.length) throw new Error('No audio streams')
      const best = audioStreams.find((s: any) => s.mimeType && s.mimeType.includes('audio/mp4')) || audioStreams[0]
      if (!best?.url) throw new Error('No URL in stream')
      return { url: best.url, mimeType: best.mimeType || 'audio/mp4' }
    }),
  )

  if (pipedStream) return pipedStream

  return null
}
