// lib/serverUser.ts
// Helper dùng chung cho MỌI API route xử lý dữ liệu riêng tư (favorite, lịch sử nghe, playlist...)
// Nguyên tắc bắt buộc: user_id LUÔN được tính từ session đã xác thực ở server,
// KHÔNG BAO GIỜ nhận trực tiếp từ body/query do client gửi lên (tránh giả mạo user khác).

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/authOptions'
import { createClient } from '@supabase/supabase-js'
import { getValidUserId } from '@/lib/accessControl'

// Client dùng service_role — CHỈ được import trong code chạy ở server (API routes),
// tuyệt đối không import file này vào component client ('use client').
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-service-key'

export const adminClient = createClient(
  supabaseUrl,
  serviceRoleKey,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

/**
 * Lấy userId chuẩn (đã xác thực) của người dùng hiện tại từ NextAuth session.
 * Trả về null nếu chưa đăng nhập.
 */
export async function getAuthenticatedUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return getValidUserId({ email: session.user.email })
}

/**
 * Dùng trong route handler: trả sẵn Response 401 nếu chưa đăng nhập,
 * hoặc trả về userId để dùng tiếp.
 *
 * Cách dùng:
 *   const auth = await requireUser()
 *   if (auth instanceof Response) return auth
 *   const userId = auth
 */
export async function requireUser(): Promise<string | Response> {
  const userId = await getAuthenticatedUserId()
  if (!userId) {
    return Response.json({ error: 'Vui lòng đăng nhập' }, { status: 401 })
  }
  return userId
}

/**
 * QUAN TRỌNG: Vì service_role bypass RLS hoàn toàn, các route thao tác trên
 * playlist/playlist_tracks PHẢI tự kiểm tra quyền sở hữu bằng hàm này trước
 * khi update/delete — nếu không, bất kỳ user nào cũng có thể sửa/xóa playlist
 * của người khác chỉ bằng cách đổi id trên URL.
 *
 * Trả về playlist nếu đúng chủ sở hữu, hoặc Response lỗi (404/403) nếu không.
 */
export async function requirePlaylistOwner(
  playlistId: string,
  userId: string
): Promise<{ id: string; user_id: string } | Response> {
  const { data: playlist, error } = await adminClient
    .from('playlists')
    .select('id, user_id')
    .eq('id', playlistId)
    .single()

  if (error || !playlist) {
    return Response.json({ error: 'Playlist không tồn tại' }, { status: 404 })
  }
  if (playlist.user_id !== userId) {
    return Response.json({ error: 'Bạn không có quyền với playlist này' }, { status: 403 })
  }
  return playlist
}
