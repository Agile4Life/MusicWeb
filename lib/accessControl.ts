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
    return allowedConfig.allowedEmails.some(
      (item) => item.email && item.email.trim().toLowerCase() === normalizedEmail
    )
  }

  return false
}

/** Converts any user object or email into a valid Postgres UUID format */
export function getValidUserId(user?: any): string {
  if (!user) return '00000000-0000-4000-a000-000000000000'
  if (user.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) {
    return user.id
  }
  const email = (user.email || user.id || 'default@musicweb.com').trim().toLowerCase()
  let hex = ''
  for (let i = 0; i < email.length; i++) {
    hex += email.charCodeAt(i).toString(16)
  }
  hex = (hex + '0123456789abcdef0123456789abcdef').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
