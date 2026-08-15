// app/api/history/delete/route.ts
import { requireUser, adminClient } from '@/lib/serverUser'

export async function POST(req: Request) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const body = await req.json().catch(() => null)
  const historyId = body?.historyId // xóa 1 mục
  const clearAll = body?.clearAll === true // xóa toàn bộ

  try {
    if (clearAll) {
      const { error } = await adminClient
        .from('listening_history')
        .delete()
        .eq('user_id', userId)
      if (error) throw error
      return Response.json({ success: true })
    }

    if (historyId) {
      // Kiểm tra quyền sở hữu trước khi xóa — tránh xóa lịch sử của người khác qua id đoán được
      const { error } = await adminClient
        .from('listening_history')
        .delete()
        .eq('id', historyId)
        .eq('user_id', userId)
      if (error) throw error
      return Response.json({ success: true })
    }

    return Response.json({ error: 'Thiếu historyId hoặc clearAll' }, { status: 400 })
  } catch (err: any) {
    console.error('[history/delete] Failed:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
