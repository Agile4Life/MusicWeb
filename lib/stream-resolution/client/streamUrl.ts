import { getNhacCuaTuiStreamUrl } from '@/lib/nhaccuatuiClient'

export function buildStableProxyStreamUrl(source: string, id: string): string {
  if (!id) return ''
  switch (source) {
    case 'nhaccuatui':
      return getNhacCuaTuiStreamUrl(id) || `/api/nhaccuatui/stream?id=${encodeURIComponent(id)}`
    case 'soundcloud':
      return `/api/soundcloud/stream?id=${encodeURIComponent(id)}`
    case 'drive': {
      const match = id.match(/\/d\/([a-zA-Z0-9_-]+)/) || id.match(/id=([a-zA-Z0-9_-]+)/)
      const fileId = match ? match[1] : id
      return fileId.startsWith('http') || fileId.startsWith('/') ? fileId : `/api/drive-stream?fileId=${encodeURIComponent(fileId)}`
    }
    case 'youtube':
      return `/api/yt-stream?id=${encodeURIComponent(id)}`
    default:
      return id
  }
}
