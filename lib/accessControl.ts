import allowedConfig from '@/config/allowedAccounts.json'

export type UserRole = 'admin' | 'listener'

/**
 * Evaluates the user role based on email address configured in config/allowedAccounts.json.
 * Defaults to 'listener' for non-admin accounts.
 */
export function getUserRole(email?: string | null): UserRole {
  if (!email) return 'listener'

  const normalizedEmail = email.trim().toLowerCase()

  // 1. Check direct adminEmails list
  if (Array.isArray(allowedConfig.adminEmails)) {
    if (allowedConfig.adminEmails.some((e) => e.trim().toLowerCase() === normalizedEmail)) {
      return 'admin'
    }
  }

  // 2. Check allowedEmails array for specific role definition
  if (Array.isArray(allowedConfig.allowedEmails)) {
    const found = allowedConfig.allowedEmails.find(
      (item) => item.email && item.email.trim().toLowerCase() === normalizedEmail
    )
    if (found && found.role === 'admin') {
      return 'admin'
    }
  }

  return 'listener'
}

/** Returns true if the given email has Admin privileges */
export function isAdmin(email?: string | null): boolean {
  return getUserRole(email) === 'admin'
}

/** Returns true if the account is allowed to log into the application */
export function isAllowedToLogin(email?: string | null): boolean {
  if (!email) return false
  if (allowedConfig.allowAllAsListeners) return true

  const normalizedEmail = email.trim().toLowerCase()

  if (Array.isArray(allowedConfig.adminEmails)) {
    if (allowedConfig.adminEmails.some((e) => e.trim().toLowerCase() === normalizedEmail)) {
      return true
    }
  }

  if (Array.isArray(allowedConfig.allowedEmails)) {
    if (allowedConfig.allowedEmails.some((item) => item.email && item.email.trim().toLowerCase() === normalizedEmail)) {
      return true
    }
  }

  // Check client-side approved passkey emails (stored in localStorage)
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('musicweb_approved_emails')
      if (stored) {
        const approvedList: string[] = JSON.parse(stored)
        if (Array.isArray(approvedList) && approvedList.some((e) => e.trim().toLowerCase() === normalizedEmail)) {
          return true
        }
      }
    } catch {
      // ignore parsing error
    }

    // Also check the approved_emails cookie (set by Passkey API and client-side)
    try {
      const cookieStr = document.cookie
      const match = cookieStr.match(/(?:^|;\s*)approved_emails=([^;]*)/)
      if (match?.[1]) {
        let decoded = match[1]
        try {
          decoded = decodeURIComponent(decoded)
        } catch {}
        try {
          const parsed = JSON.parse(decoded)
          if (Array.isArray(parsed) && parsed.some((e: string) => String(e).trim().toLowerCase() === normalizedEmail)) {
            return true
          }
        } catch {}
      }
    } catch {
      // ignore cookie parsing error
    }
  }

  return false
}

/** Utility to mark an email as authorized via Passkey verification */
export function markEmailAsAllowed(email: string) {  if (typeof window === 'undefined' || !email) return
  try {
    const normalized = email.trim().toLowerCase()

    // 1. Update localStorage
    const stored = localStorage.getItem('musicweb_approved_emails')
    const list: string[] = stored ? JSON.parse(stored) : []
    if (!list.includes(normalized)) {
      list.push(normalized)
      localStorage.setItem('musicweb_approved_emails', JSON.stringify(list))
    }

    // 2. Update cookie — use plain JSON (no encodeURIComponent wrapper)
    //    so both client JS and server-side NextAuth can parse it consistently
    let cookieList: string[] = []
    try {
      const cookieStr = document.cookie
      const match = cookieStr.match(/(?:^|;\s*)approved_emails=([^;]*)/)
      if (match?.[1]) {
        let decoded = match[1]
        try { decoded = decodeURIComponent(decoded) } catch {}
        const parsed = JSON.parse(decoded)
        if (Array.isArray(parsed)) cookieList = parsed
      }
    } catch {}
    if (!cookieList.includes(normalized)) {
      cookieList.push(normalized)
    }
    document.cookie = `approved_emails=${JSON.stringify(cookieList)}; path=/; max-age=31536000; SameSite=Lax`
  } catch {
    // ignore storage error
  }
}

/**
 * Client-side wrapper for the server approval check (/api/check-approval).
 * Returns true when the email is approved in the bundled config allowlist OR in
 * the server-persistent Supabase roles table (passkey/register approvals).
 */
export async function checkServerApproval(email?: string | null): Promise<boolean> {
  if (!email) return false
  try {
    const res = await fetch(
      `/api/check-approval?email=${encodeURIComponent(email.trim().toLowerCase())}`,
      { cache: 'no-store' }
    )
    if (!res.ok) return false
    const data = await res.json()
    return Boolean(data?.approved)
  } catch {
    return false
  }
}



/** Converts any user object or email into a valid Postgres UUID format */
export function getValidUserId(user?: any): string {
  if (!user) return '00000000-0000-4000-a000-000000000000'

  const possibleId = user.id || user.user_id || user.sub
  if (possibleId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(possibleId)) {
    return possibleId
  }

  const email = (user.email || possibleId || 'default@musicweb.com').trim().toLowerCase()
  let rawHex = ''
  for (let i = 0; i < email.length; i++) {
    rawHex += email.charCodeAt(i).toString(16)
  }
  // Ensure we have at least 30 hex characters by repeating
  let hex = rawHex
  while (hex.length < 30) {
    hex += '0123456789abcdef'
  }
  hex = hex.slice(0, 30)

  // Format into 8-4-4-4-12 UUID using continuous hex slices without skipping any indices
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(12, 15)}-a${hex.slice(15, 18)}-${hex.slice(18, 30)}`
}

/** Collects all candidate user IDs for a given user identity across Supabase Auth and NextAuth */
export function getAllValidUserIds(currentUser?: any, nextAuthSession?: any): string[] {
  const ids = new Set<string>()

  if (currentUser) {
    if (typeof currentUser === 'string') {
      const email = currentUser.trim().toLowerCase()
      if (email) {
        ids.add(getValidUserId({ email }))
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentUser)) {
          ids.add(currentUser)
        }
      }
    } else {
      const cid = getValidUserId(currentUser)
      if (cid) ids.add(cid)
      if (currentUser.email) {
        ids.add(getValidUserId({ email: currentUser.email }))
      }
    }
  }

  if (nextAuthSession) {
    if (typeof nextAuthSession === 'string') {
      const email = nextAuthSession.trim().toLowerCase()
      if (email) {
        ids.add(getValidUserId({ email }))
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nextAuthSession)) {
          ids.add(nextAuthSession)
        }
      }
    } else if (nextAuthSession.user) {
      const nid = getValidUserId(nextAuthSession.user)
      if (nid) ids.add(nid)
      if (nextAuthSession.user.email) {
        ids.add(getValidUserId({ email: nextAuthSession.user.email }))
      }
    } else if (nextAuthSession.email) {
      const nid = getValidUserId({ email: nextAuthSession.email })
      if (nid) ids.add(nid)
    }
  }

  return Array.from(ids).filter(Boolean)
}

