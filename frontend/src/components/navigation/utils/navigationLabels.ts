import type { User } from '@/api/auth'

/**
 * Formats release versions with a leading v while preserving already-prefixed versions
 */
export function formatVersionLabel(version: string): string {
  const trimmedVersion = version.trim()
  return trimmedVersion.toLowerCase().startsWith('v') ? trimmedVersion : `v${trimmedVersion}`
}

/**
 * Builds the navigation footer version label and falls back to the product name when the version is empty
 */
export function getCurrentVersionLabel(version: string): string {
  const trimmedVersion = version.trim()
  return trimmedVersion ? `Lumina Finance ${formatVersionLabel(trimmedVersion)}` : 'Lumina Finance'
}

/**
 * Builds the authenticated user display name from profile fields after refresh state has loaded
 */
export function getNavigationDisplayName(user: User | null | undefined): string {
  if (!user) return ''
  return `${user.first_name}${user.last_name ? ` ${user.last_name}` : ''}`
}

/**
 * Builds compact avatar initials from the authenticated user profile
 */
export function getNavigationInitials(user: User | null | undefined): string {
  if (!user) return ''
  return `${user.first_name[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase()
}

