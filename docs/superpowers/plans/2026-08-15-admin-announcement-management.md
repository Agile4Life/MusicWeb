# Admin Announcement Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide an in-app announcement management system allowing only Admin users to view, edit, toggle, and publish announcement modal content stored in Supabase with automatic real-time sync across all clients.

**Architecture:** A dedicated data model and API endpoint (`/api/announcement`) backed by Supabase with Admin authentication (`isAdmin(user.email)` from `lib/accessControl.ts`). An interactive Live Modal Editor embedded directly inside `WelcomeAnnouncementModal.tsx` and an Admin Management Card inside `app/(app)/settings/page.tsx`.

**Tech Stack:** Next.js 15 App Router, React 19, Supabase, NextAuth / Passkey Auth, Tailwind CSS, Lucide Icons, Vitest.

## Global Constraints
- Only authenticated users with `isAdmin(email) === true` can access the editor UI and call `POST /api/announcement`.
- Non-admin callers receive `403 Forbidden` from `POST /api/announcement`.
- All visitors receive the latest announcement via `GET /api/announcement` with graceful fallback to `DEFAULT_ANNOUNCEMENT`.
- When an announcement's content or version is updated by Admin, clients see the updated modal even if previously dismissed.

---

### Task 1: Create Announcement Core Types & Validation Helper

**Files:**
- Create: `lib/announcement.ts`
- Test: `lib/__tests__/announcement.test.ts`

**Interfaces:**
- Produces: `AnnouncementData`, `DEFAULT_ANNOUNCEMENT`, `validateAnnouncementPayload(payload: any): { valid: boolean; error?: string; data?: AnnouncementData }`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/__tests__/announcement.test.ts
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
  })

  it('rejects invalid payloads with missing title or content', () => {
    const invalidPayload = { title: '', content: '' }
    const result = validateAnnouncementPayload(invalidPayload)
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test lib/__tests__/announcement.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `lib/announcement.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test lib/__tests__/announcement.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/announcement.ts lib/__tests__/announcement.test.ts
git commit -m "feat(announcement): add core announcement types and validation helpers"
```

---

### Task 2: Create API Route `/api/announcement`

**Files:**
- Create: `app/api/announcement/route.ts`
- Test: `app/api/announcement/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `AnnouncementData`, `DEFAULT_ANNOUNCEMENT`, `validateAnnouncementPayload` from `lib/announcement.ts`, `isAdmin` from `lib/accessControl.ts`
- Produces: `GET /api/announcement` -> `{ success: true, data: AnnouncementData }`, `POST /api/announcement` -> `{ success: true, data: AnnouncementData }` or `403` / `400`

- [ ] **Step 1: Write the failing test**

```typescript
// app/api/announcement/__tests__/route.test.ts
import { describe, it, expect, vi } from 'vitest'
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
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test app/api/announcement/__tests__/route.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `app/api/announcement/route.ts`**

```typescript
// app/api/announcement/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_ANNOUNCEMENT, validateAnnouncementPayload } from '@/lib/announcement'
import { isAdmin } from '@/lib/accessControl'

function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !key) return null
  return createClient(url, key)
}

export async function GET(_req: NextRequest) {
  try {
    const supabase = getSupabaseServerClient()
    if (supabase) {
      const { data, error } = await supabase
        .from('system_announcements')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!error && data) {
        return NextResponse.json({ success: true, data }, { status: 200 })
      }
    }
    return NextResponse.json({ success: true, data: DEFAULT_ANNOUNCEMENT }, { status: 200 })
  } catch (err) {
    return NextResponse.json({ success: true, data: DEFAULT_ANNOUNCEMENT }, { status: 200 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = body.senderEmail || req.headers.get('x-user-email') || ''

    if (!isAdmin(email)) {
      return NextResponse.json(
        { success: false, error: 'Chỉ tài khoản Admin mới có quyền chỉnh sửa thông báo.' },
        { status: 403 }
      )
    }

    const { valid, error, data } = validateAnnouncementPayload(body)
    if (!valid || !data) {
      return NextResponse.json({ success: false, error }, { status: 400 })
    }

    const supabase = getSupabaseServerClient()
    if (supabase) {
      const { data: saved, error: dbError } = await supabase
        .from('system_announcements')
        .upsert({
          id: 'welcome_announcement',
          badge: data.badge,
          title: data.title,
          content: data.content,
          facebook_url: data.facebook_url,
          instagram_url: data.instagram_url,
          contact_email: data.contact_email,
          cta_text: data.cta_text,
          is_enabled: data.is_enabled,
          version: (data.version || 1) + 1,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (!dbError && saved) {
        return NextResponse.json({ success: true, data: saved }, { status: 200 })
      }
    }

    return NextResponse.json({ success: true, data }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Lỗi xử lý server' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test app/api/announcement/__tests__/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/announcement/route.ts app/api/announcement/__tests__/route.test.ts
git commit -m "feat(api): create announcement route with admin authorization"
```

---

### Task 3: Implement Live Modal Editor in `WelcomeAnnouncementModal.tsx`

**Files:**
- Modify: `components/modals/WelcomeAnnouncementModal.tsx`

**Interfaces:**
- Consumes: `AnnouncementData`, `DEFAULT_ANNOUNCEMENT` from `lib/announcement.ts`, `useCurrentUser()` from `components/auth/CurrentUserContext`, `isAdmin` from `lib/accessControl.ts`
- Produces: Live Modal Editor and View Modal toggleable for Admin, Toast notification on update.

- [ ] **Step 1: Integrate announcement state fetching & Live Editor UI**
- [ ] **Step 2: Add Admin action buttons (Edit, Save, Cancel, Toggle status)**
- [ ] **Step 3: Run unit tests to verify behavior**
- [ ] **Step 4: Commit changes**

```bash
git add components/modals/WelcomeAnnouncementModal.tsx
git commit -m "feat(modal): add live announcement editor for admin role"
```

---

### Task 4: Integrate Admin Announcement Management in `SettingsPage`

**Files:**
- Modify: `app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: `useCurrentUser()`, `isAdmin()`
- Produces: Dedicated Admin Announcement Control Card with live status and quick trigger.

- [ ] **Step 1: Add Admin Announcement Management section in `SettingsPage`**
- [ ] **Step 2: Connect trigger event to open Live Modal Editor**
- [ ] **Step 3: Verify TypeScript and unit tests**
- [ ] **Step 4: Commit changes**

```bash
git add app/(app)/settings/page.tsx
git commit -m "feat(settings): add admin announcement control card"
```

---

### Task 5: Run Full Test Suite & Verification

- [ ] **Step 1: Run `npm.cmd test` for entire test suite**
- [ ] **Step 2: Verify zero TypeScript and lint errors**
- [ ] **Step 3: Verification before completion**
