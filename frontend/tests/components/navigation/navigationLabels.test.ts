/**
 * Tests navigation label helpers so refactors catch broken release labels and authenticated user labels before the navigation renders
 */
import { describe, expect, it } from 'vitest'
import type { User } from '@/api/auth'
import {
  formatVersionLabel,
  getCurrentVersionLabel,
  getNavigationDisplayName,
  getNavigationInitials,
} from '@/components/navigation/utils/labels'

const user: User = {
  id: 'user-1',
  email: 'dana@example.com',
  first_name: 'Dana',
  last_name: 'Li',
  tz: 'America/Toronto',
  base_currency: 'CAD',
  created_at: '2026-01-01T00:00:00Z',
}

describe('navigation labels', () => {
  it('formats current version labels with product context and a stable v prefix', () => {
    expect(formatVersionLabel('0.7.0')).toBe('v0.7.0')
    expect(formatVersionLabel('v0.7.0')).toBe('v0.7.0')
    expect(getCurrentVersionLabel('0.7.0')).toBe('Lumina Finance v0.7.0')
    expect(getCurrentVersionLabel('   ')).toBe('Lumina Finance')
  })

  it('builds user display names and initials from optional profile fields', () => {
    expect(getNavigationDisplayName(user)).toBe('Dana Li')
    expect(getNavigationInitials(user)).toBe('DL')
    expect(getNavigationDisplayName({ ...user, last_name: null })).toBe('Dana')
    expect(getNavigationInitials({ ...user, last_name: null })).toBe('D')
    expect(getNavigationDisplayName(null)).toBe('')
    expect(getNavigationInitials(undefined)).toBe('')
  })
})
