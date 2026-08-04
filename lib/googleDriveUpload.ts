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
  return `${WORKER_URL}/api/upload/stream?id=${encodeURIComponent(fileId)}`;
}

export async function deleteGoogleDriveFile(fileId: string, uploadUrl: string): Promise<void> {
  if (!fileId || !uploadUrl) return
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined
  const response = await fetch(`${WORKER_URL}/api/upload/file?id=${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'X-Upload-Url': uploadUrl },
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

    let initRes: Response
    try {
      initRes = await fetch(`${WORKER_URL}/api/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: targetName, fileSize, fileType, folderName, origin: browserOrigin }),
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
