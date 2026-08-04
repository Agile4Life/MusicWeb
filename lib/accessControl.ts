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
