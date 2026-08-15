import { describe, it, expect } from 'vitest'
import { DEFAULT_ANNOUNCEMENT, validateAnnouncementPayload } from '../announcement'

describe('Announcement Core Types & Validation', () => {
  it('has valid default announcement structure', () => {
    expect(DEFAULT_ANNOUNCEMENT.title).toBeTruthy()
    expect(DEFAULT_ANNOUNCEMENT.content).toBeTruthy()
    expect(DEFAULT_ANNOUNCEMENT.is_enabled).toBe(true)
  })

  it('validates a correct payload', () => {
    const payload = {
      badge: 'Thông báo mới',
      title: 'Tiêu đề cập nhật',
      content: 'Nội dung thông báo mới gửi người dùng',
      facebook_url: 'https://facebook.com/test',
      instagram_url: 'https://instagram.com/test',
      contact_email: 'admin@musicweb.com',
      cta_text: 'Đã hiểu',
      is_enabled: true,
    }
    const result = validateAnnouncementPayload(payload)
    expect(result.valid).toBe(true)
    expect(result.data?.title).toBe('Tiêu đề cập nhật')
    expect(result.data?.content).toBe('Nội dung thông báo mới gửi người dùng')
  })

  it('rejects invalid payloads with missing title or content', () => {
    const invalidPayload = { title: '', content: '' }
    const result = validateAnnouncementPayload(invalidPayload)
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('rejects null or non-object payloads', () => {
    expect(validateAnnouncementPayload(null).valid).toBe(false)
    expect(validateAnnouncementPayload('string').valid).toBe(false)
  })
})
