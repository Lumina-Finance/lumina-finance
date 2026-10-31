/**
 * Covers a tab taking a renewed session: its own user's renewal carries on, while one that returns
 * another user, signed in since in another tab, signs the tab out with nothing of either user cached
 */
import { QueryClient } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { AuthResponse, User } from '@/api/auth'
import type { AuthState } from '@/contexts/AuthContext'
import { takeRenewedSession } from '@/contexts/sessionRenewal'

/** Builds a user with the given id */
function user(id: string): User {
  return {
    id,
    email: `${id}@example.com`,
    first_name: 'Test',
    last_name: null,
    tz: 'America/Toronto',
    base_currency: 'CAD',
    date_format: 'month-day-year',
    action_key: 'alt',
    created_at: '2026-06-12T00:00:00Z',
    second_factor_reenrollment_required: false,
  }
}

const tabState: AuthState = { user: user('user-a'), accessToken: 'old-access-token', loading: false }

/** A renewal that returned this user's session */
function renewalFor(id: string): AuthResponse {
  return { user: user(id), access_token: `${id}-access-token`, token_type: 'bearer' }
}

const clients: QueryClient[] = []

/** A query cache holding the tab's user's data */
function cacheWithAccounts() {
  const client = new QueryClient()
  clients.push(client)
  client.setQueryData(['accounts'], [{ id: 'first-user-account' }])
  return client
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
})

it('signs the tab out and clears its cache when the renewal returns another user', () => {
  const client = cacheWithAccounts()
  const applyState = vi.fn()

  expect(takeRenewedSession(tabState, renewalFor('user-c'), client, applyState)).toBe(false)

  expect(applyState).toHaveBeenCalledExactlyOnceWith({ user: null, accessToken: null, loading: false })
  expect(client.getQueryData(['accounts'])).toBeUndefined()
})

it("takes a renewal for the tab's own user and keeps its cache", () => {
  const client = cacheWithAccounts()
  const applyState = vi.fn()

  expect(takeRenewedSession(tabState, renewalFor('user-a'), client, applyState)).toBe(true)

  expect(applyState).toHaveBeenCalledExactlyOnceWith({
    user: user('user-a'),
    accessToken: 'user-a-access-token',
    loading: false,
  })
  expect(client.getQueryData(['accounts'])).toEqual([{ id: 'first-user-account' }])
})
