/**
 * Utility function for uploading large files to Google Drive using Cloudflare Worker Resumable Upload API.
 * 
 * Features:
 * - Chunked upload (5MB chunks, multiple of 256KB)
 * - Real-time progress callback
 * - Direct upload from browser to Google Drive (Zero server bandwidth load)
 * - Automatic subfolder creation for playlists
 */

const WORKER_URL = process.env.NEXT_PUBLIC_CLOUDFLARE_WORKER_URL || 'https://drive-upload-worker.phongtct.workers.dev';
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB per chunk (must be a multiple of 256KB)

export interface GoogleDriveUploadOptions {
  file: File;
  fileName?: string;
  folderName?: string; // Tên Playlist / Thư mục con trên Google Drive
  onProgress?: (progress: { percent: number; uploadedBytes: number; totalBytes: number }) => void;
}

export interface GoogleDriveUploadResult {
  success: boolean;
  fileId?: string;
  uploadUrl?: string;
  error?: string;
}

export async function uploadToGoogleDrive({
  file,
  fileName,
  folderName,
  onProgress,
}: GoogleDriveUploadOptions): Promise<GoogleDriveUploadResult> {
  try {
    const targetName = fileName || file.name;
    const fileSize = file.size;
    const fileType = file.type || 'application/octet-stream';

    // 1. Initialize Resumable Upload Session via Cloudflare Worker (với tên Thư mục con nếu có)
    const initRes = await fetch(`${WORKER_URL}/api/upload/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: targetName,
        fileSize,
        fileType,
        folderName,
      }),
    });

    if (!initRes.ok) {
      const errorData = await initRes.json().catch(() => ({}));
      throw new Error(errorData.error || `Lỗi khởi tạo upload: HTTP ${initRes.status}`);
    }

    const { uploadUrl } = await initRes.json();
    if (!uploadUrl) {
      throw new Error('Cloudflare Worker không trả về Upload Session URL');
    }

    // 2. Upload file in chunks directly to Google Drive Resumable Upload Session URL
    let start = 0;
    const total = fileSize;

    while (start < total) {
      const end = Math.min(start + CHUNK_SIZE, total);
      const chunk = file.slice(start, end);

      const chunkRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${start}-${end - 1}/${total}`,
        },
        body: chunk,
      });

      if (chunkRes.status !== 308 && !chunkRes.ok) {
        throw new Error(`Upload chunk thất bại ở byte ${start}-${end}: HTTP ${chunkRes.status}`);
      }

      start = end;
      const percent = Math.round((start / total) * 100);

      if (onProgress) {
        onProgress({
          percent,
          uploadedBytes: start,
          totalBytes: total,
        });
      }

      if (chunkRes.ok && (chunkRes.status === 200 || chunkRes.status === 201)) {
        const finalData = await chunkRes.json().catch(() => ({}));
        return {
          success: true,
          fileId: finalData.id,
          uploadUrl,
        };
      }
    }

    return {
      success: true,
      uploadUrl,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Lỗi không xác định khi upload lên Google Drive',
    };
  }
}
