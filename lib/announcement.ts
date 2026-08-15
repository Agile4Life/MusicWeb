// lib/announcement.ts

export interface AnnouncementData {
  id?: string
  badge: string
  title: string
  content: string
  facebook_url?: string
  instagram_url?: string
  contact_email?: string
  cta_text?: string
  is_enabled: boolean
  updated_at?: string
  version?: number
}

export const DEFAULT_ANNOUNCEMENT: AnnouncementData = {
  badge: 'Thông báo từ Tác giả',
  title: 'Chào mừng bạn đến với MusicWeb 🎵',
  content:
    'Phong cảm ơn tất cả mọi người đã trải nghiệm web đầu tay của Phong! Nếu có thắc mắc, feedback đóng góp hoặc cần Phong bổ sung tính năng gì, mọi người hãy liên hệ trực tiếp với mình qua các kênh bên dưới nhé:',
  facebook_url: 'https://www.facebook.com/phong.trancongtuan',
  instagram_url: 'https://www.instagram.com/phongtct/',
  contact_email: 'tranphong16012006@gmail.com',
  cta_text: 'Đã hiểu & Bắt đầu',
  is_enabled: true,
  version: 1,
}

export function validateAnnouncementPayload(payload: any): {
  valid: boolean
  error?: string
  data?: AnnouncementData
} {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Payload không hợp lệ' }
  }

  const title = String(payload.title || '').trim()
  const content = String(payload.content || '').trim()

  if (!title) {
    return { valid: false, error: 'Tiêu đề thông báo không được để trống' }
  }
  if (!content) {
    return { valid: false, error: 'Nội dung thông báo không được để trống' }
  }

  const sanitized: AnnouncementData = {
    badge: String(payload.badge || DEFAULT_ANNOUNCEMENT.badge).trim(),
    title,
    content,
    facebook_url: payload.facebook_url ? String(payload.facebook_url).trim() : undefined,
    instagram_url: payload.instagram_url ? String(payload.instagram_url).trim() : undefined,
    contact_email: payload.contact_email ? String(payload.contact_email).trim() : undefined,
    cta_text: payload.cta_text ? String(payload.cta_text).trim() : DEFAULT_ANNOUNCEMENT.cta_text,
    is_enabled: payload.is_enabled !== false,
    version: typeof payload.version === 'number' ? payload.version : 1,
    updated_at: new Date().toISOString(),
  }

  return { valid: true, data: sanitized }
}
