/**
 * Upload large files to Google Drive via Cloudflare Worker Resumable Upload API.
 *
 * Flow:
 *   Browser → POST /api/upload/init (Cloudflare Worker) → Google Drive Resumable Session
 *   Browser → PUT chunks directly to Google Drive (zero server bandwidth)
 *
 * Google Drive stream URL format:
 *   https://drive.google.com/uc?export=download&id={fileId}
 */

const WORKER_URL = process.env.NEXT_PUBLIC_CLOUDFLARE_WORKER_URL || 'https://drive-upload-worker.phongtct.workers.dev';
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB — must be multiple of 256 KiB

async function getAuthorizationHeader(): Promise<Record<string, string>> {
  try {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      return { Authorization: `Bearer ${session.access_token}` }
    }
  } catch (e) {
    // Ignore error when no Supabase session exists
  }
  return { Authorization: 'Bearer musicweb_app_token' }
}

async function getFileHash(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function describeFetchError(error: unknown, step: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (message.toLowerCase() === 'failed to fetch' || message.toLowerCase().includes('networkerror')) {
    return new Error(
      `${step} không kết nối được tới Cloudflare Worker/Google Drive. ` +
      'Kiểm tra Worker đang hoạt động và Worker phải proxy chunk upload hoặc trả CORS cho origin của website.'
    )
  }
  return error instanceof Error ? error : new Error(message)
}

export interface GoogleDriveUploadOptions {
  file: File;
  fileName?: string;
  folderName?: string;
  onProgress?: (progress: { percent: number; uploadedBytes: number; totalBytes: number }) => void;
}

export interface GoogleDriveUploadResult {
  success: boolean;
  duplicate?: boolean;
  fileId?: string;
  uploadUrl?: string;
  fileName?: string;
  streamUrl?: string;
  error?: string;
}

/**
 * Build a direct-download / streaming URL from a Google Drive file ID.
 * This URL works with HTML5 <audio> and <video> elements.
 */
export function buildDriveStreamUrl(fileId: string): string {
  return `/api/drive-stream?id=${encodeURIComponent(fileId)}`;
}

export function isPreviewUrl(filePath: string): boolean {
  if (!filePath) return false
  const lower = filePath.toLowerCase()
  return (
    lower.includes('preview') ||
    lower.includes('audio-ssl.itunes.apple.com') ||
    lower.includes('p.scdn.co') ||
    lower.includes('spotify.com')
  )
}

export async function verifyDriveFile(filePath: string): Promise<{ valid: boolean; driveId?: string; streamUrl?: string }> {
  if (!filePath || isPreviewUrl(filePath)) {
    return { valid: false }
  }

  const driveId = extractDriveFileId(filePath)
  if (!driveId) {
    if (filePath.startsWith('http') && !filePath.includes('drive.google.com')) {
      return { valid: true, streamUrl: filePath }
    }
    return { valid: false }
  }

  const streamUrl = buildDriveStreamUrl(driveId)
  return { valid: true, driveId, streamUrl }
}


export function extractDriveFileId(filePath: string): string | null {
  if (!filePath) return null
  const trimmed = filePath.trim()
  if (trimmed.includes('/folders/') || trimmed.includes('drive/folders')) return null

  // Reject standard UUIDs (Supabase track IDs/file paths)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return null
  }

  const regexMatch =
    trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]{18,45})/) ||
    trimmed.match(/\/d\/([a-zA-Z0-9_-]{18,45})/) ||
    trimmed.match(/[?&]id=([a-zA-Z0-9_-]{18,45})/)

  if (regexMatch && regexMatch[1]) {
    return regexMatch[1]
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.pathname.includes('/folders/')) return null
    const id =
      parsed.searchParams.get('id') ||
      parsed.pathname.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1] ||
      parsed.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/)?.[1]
    if (id && /^[A-Za-z0-9_-]{18,45}$/.test(id)) return id
  } catch {
    if (
      /^[A-Za-z0-9_-]{25,45}$/.test(trimmed) &&
      !trimmed.includes('http') &&
      !trimmed.includes('/') &&
      !trimmed.includes('.') &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(trimmed)
    ) {
      return trimmed
    }
  }
  return null
}

export function extractDriveFolderId(input: string): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (/^[A-Za-z0-9_-]{18,45}$/.test(trimmed) && !trimmed.includes('http') && !trimmed.includes('/') && !trimmed.includes('.')) {
    return trimmed
  }
  const regexMatch =
    trimmed.match(/\/folders\/([a-zA-Z0-9_-]{18,45})/) ||
    trimmed.match(/[?&]id=([a-zA-Z0-9_-]{18,45})/)
  if (regexMatch && regexMatch[1]) {
    return regexMatch[1]
  }
  try {
    const parsed = new URL(trimmed)
    const match = parsed.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/)
    if (match && match[1]) return match[1]
    const idParam = parsed.searchParams.get('id')
    if (idParam) return idParam
  } catch {
    // Not a URL
  }
  return null
}

export function parseFilenameToTitleArtist(fileName: string): { title: string; artist: string } {
  let cleanName = fileName.replace(/\.(mp3|flac|wav|m4a|aac|ogg|wma)$/i, '').trim()
  
  // Clean leading track numbers like "23. ", "01 - ", "04_ ", "15) "
  const leadingNumRegex = /^\s*\d{1,3}[\.\_\-\:\)\s\|]+\s*/
  cleanName = cleanName.replace(leadingNumRegex, '').trim()

  if (cleanName.includes(' - ')) {
    const parts = cleanName.split(' - ')
    if (parts.length >= 2) {
      let artistPart = parts[0].trim().replace(leadingNumRegex, '').trim()
      let titlePart = parts.slice(1).join(' - ').trim().replace(leadingNumRegex, '').trim()

      return {
        artist: artistPart,
        title: titlePart,
      }
    }
  }

  return {
    title: cleanName,
    artist: 'Chưa rõ nghệ sĩ',
  }
}

const clientFolderCache = new Map<string, { files: Array<{ id: string; name: string }>; timestamp: number }>()

export async function fetchDriveFolderFiles(folderId: string): Promise<Array<{ id: string; name: string }>> {
  if (clientFolderCache.has(folderId)) {
    const entry = clientFolderCache.get(folderId)!
    if (Date.now() - entry.timestamp < 15 * 60 * 1000) {
      return entry.files
    }
  }

  // 1. Try local API route that parses public Google Drive folder
  try {
    const localRes = await fetch(`/api/drive-folder?folderId=${encodeURIComponent(folderId)}`, {
      method: 'GET',
    })
    if (localRes.ok) {
      const data = await localRes.json()
      if (data.success && Array.isArray(data.files) && data.files.length > 0) {
        clientFolderCache.set(folderId, { files: data.files, timestamp: Date.now() })
        return data.files
      }
    }
  } catch (e) {
    console.warn('Local drive-folder route error:', e)
  }

  // 2. Fallback to Worker API
  try {
    const auth = await getAuthorizationHeader()
    const url = `${WORKER_URL}/api/upload/list?folderId=${encodeURIComponent(folderId)}`
    const res = await fetch(url, {
      method: 'GET',
      headers: { ...auth },
    })
    if (res.ok) {
      const data = await res.json()
      if (data.files || data.items) {
        return data.files || data.items || []
      }
    }
  } catch (e) {
    console.warn('Worker list folder error:', e)
  }

  throw new Error('Không tìm thấy file nhạc trong Thư mục. Hãy kiểm tra lại rằng Thư mục đã được chia sẻ ở chế độ "Bất kỳ ai có link đều xem được" (Public/Anyone with the link).')
}

export async function getAuthorizedDriveStreamUrl(trackId: string, fileId: string): Promise<string> {
  try {
    const auth = await getAuthorizationHeader()
    const response = await fetch(`${WORKER_URL}/api/upload/stream-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ trackId, fileId }),
      cache: 'no-store',
    })
    if (response.ok) {
      const { token } = await response.json()
      if (token) {
        return `${buildDriveStreamUrl(fileId)}&token=${encodeURIComponent(token)}`
      }
    }
  } catch (err) {
    console.warn('Could not acquire signed stream token, using direct stream URL:', err)
  }
  return buildDriveStreamUrl(fileId)
}

export async function deleteGoogleDriveFile(fileId: string, uploadUrl: string): Promise<void> {
  if (!fileId || !uploadUrl) return
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined
  const auth = await getAuthorizationHeader()
  const response = await fetch(`${WORKER_URL}/api/upload/file?id=${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'X-Upload-Url': uploadUrl, ...auth },
    body: JSON.stringify({ origin }),
  })
  if (!response.ok) throw new Error(`Không thể dọn file Drive (${response.status})`)
}

export async function uploadToGoogleDrive({
  file,
  fileName,
  folderName,
  onProgress,
}: GoogleDriveUploadOptions): Promise<GoogleDriveUploadResult> {
  try {
    // Ensure the file name keeps its original extension so Google Drive
    // can identify the MIME type correctly (e.g. "Bai Hat.mp3")
    let targetName = fileName || file.name;
    const originalExt = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
    if (originalExt && !targetName.toLowerCase().endsWith(`.${originalExt}`)) {
      targetName = `${targetName}.${originalExt}`;
    }

    const fileSize = file.size;
    const fileType = file.type || 'application/octet-stream';
    const fileHash = await getFileHash(file);

    // Guard: refuse to upload empty files (e.g. compression returned 0 bytes)
    if (!fileSize || fileSize === 0) {
      return {
        success: false,
        error: 'File có dung lượng 0 byte — không thể upload. Có thể quá trình nén bị lỗi.',
      };
    }

    // ── Step 1: Init resumable upload session via Cloudflare Worker ──
    // Send browser origin so Worker can tell Google Drive to include CORS headers
    const browserOrigin = typeof window !== 'undefined' ? window.location.origin : undefined;
    const auth = await getAuthorizationHeader()

    let initRes: Response
    try {
      initRes = await fetch(`${WORKER_URL}/api/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ fileName: targetName, fileSize, fileType, fileHash, folderName, origin: browserOrigin }),
        cache: 'no-store',
      })
    } catch (error) {
      throw describeFetchError(error, 'Khởi tạo phiên upload')
    }

    if (!initRes.ok) {
      const errBody = await initRes.text();
      let errMsg: string;
      try {
        errMsg = JSON.parse(errBody).error || errBody;
      } catch {
        errMsg = errBody;
      }
      throw new Error(`Worker trả lỗi (HTTP ${initRes.status}): ${errMsg}`);
    }

    const initData = await initRes.json();
    if (initData.duplicate && initData.fileId) {
      return {
        success: true,
        duplicate: true,
        fileId: initData.fileId,
        fileName: initData.fileName || targetName,
        streamUrl: buildDriveStreamUrl(initData.fileId),
      }
    }
    const uploadUrl = initData.uploadUrl;
    if (!uploadUrl) {
      throw new Error('Cloudflare Worker không trả về Upload Session URL');
    }

    // ── Step 2: Upload file in chunks directly to Google Drive ──
    let start = 0;
    const total = fileSize;

    while (start < total) {
      const end = Math.min(start + CHUNK_SIZE, total);
      const chunk = file.slice(start, end);

      let chunkRes: Response
      try {
        chunkRes = await fetch(`${WORKER_URL}/api/upload/chunk`, {
          method: 'PUT',
          headers: {
            'Content-Range': `bytes ${start}-${end - 1}/${total}`,
            'X-Upload-Url': uploadUrl,
            ...auth,
          },
          body: chunk,
        })
      } catch (error) {
        throw describeFetchError(error, `Upload chunk ${start}-${end - 1}`)
      }

      // Google returns 308 for intermediate chunks, 200/201 for the final one
      if (chunkRes.status !== 308 && !chunkRes.ok) {
        const errText = await chunkRes.text().catch(() => '');
        throw new Error(
          `Upload chunk thất bại (byte ${start}-${end - 1}): HTTP ${chunkRes.status} — ${errText}`
        );
      }

      start = end;

      if (onProgress) {
        onProgress({
          percent: Math.round((start / total) * 100),
          uploadedBytes: start,
          totalBytes: total,
        });
      }

      // Final chunk completed
      if (chunkRes.ok && (chunkRes.status === 200 || chunkRes.status === 201)) {
        const finalData: any = await chunkRes.json().catch(() => ({}));
        const fileId = finalData.id;
        return {
          success: true,
          fileId,
          uploadUrl,
          fileName: targetName,
          streamUrl: fileId ? buildDriveStreamUrl(fileId) : undefined,
        };
      }
    }

    // Edge case: all chunks sent but no 200/201 response received
    return { success: false, error: 'Upload hoàn tất nhưng Google Drive không trả về File ID.' };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Lỗi không xác định khi upload lên Google Drive',
    };
  }
}
