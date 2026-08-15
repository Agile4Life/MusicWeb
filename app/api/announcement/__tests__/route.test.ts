import { describe, it, expect } from 'vitest'
import { GET, POST } from '../route'
import { NextRequest } from 'next/server'

describe('Announcement API Route', () => {
  it('GET returns default announcement successfully', async () => {
    const req = new NextRequest('http://localhost:3000/api/announcement')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.title).toBeTruthy()
    expect(json.data.content).toBeTruthy()
  })

  it('POST rejects unauthorized non-admin user with 403', async () => {
    const req = new NextRequest('http://localhost:3000/api/announcement', {
      method: 'POST',
      body: JSON.stringify({
        title: 'New title',
        content: 'New content',
        senderEmail: 'nonadmin@test.com',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.success).toBe(false)
  })

  it('POST allows admin user to update announcement', async () => {
    const req = new NextRequest('http://localhost:3000/api/announcement', {
      method: 'POST',
      body: JSON.stringify({
        badge: 'Cập nhật hệ thống',
        title: 'Bảo trì máy chủ',
        content: 'Hệ thống cập nhật tính năng mới.',
        senderEmail: 'tranphong16012006@gmail.com',
        is_enabled: true,
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.title).toBe('Bảo trì máy chủ')
    expect(json.data.badge).toBe('Cập nhật hệ thống')
  })
})
