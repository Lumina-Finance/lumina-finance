import { API_BASE } from '@/api/config'
import { readStoredValue, removeStoredValue, writeStoredValue } from '@/utils/browserStorage'

const NATIVE_HANDOFF_KEY = 'lumina:native_handoff'

// A base64url SHA-256 digest without padding, the only PKCE challenge the Apple apps send
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/

/**
 * Remembers the PKCE challenge a native app opened the sign-in page with, so whichever way the user
 * signs in, including a provider roundtrip that leaves the page, ends by handing the session to the
 * app. The app opens a private browser sheet, so this session-scoped value never outlives it
 */
export function rememberNativeChallenge(search: string): void {
  const challenge = new URLSearchParams(search).get('native_challenge')
  if (challenge && CODE_CHALLENGE_PATTERN.test(challenge)) {
    writeStoredValue(NATIVE_HANDOFF_KEY, challenge, 'session')
  }
}

/** Whether this page was opened by a native app to sign in for it */
export function isNativeSignIn(): boolean {
  return readStoredValue(NATIVE_HANDOFF_KEY, 'session') !== null
}

/**
 * Hands a just-finished sign-in to the native app that opened the page, returning whether it did, so
 * the caller leaves the session uncommitted and the app never mounts in the sheet
 *
 * The page submits a top-level form, and the server answers with a redirect into the app carrying a
 * one-time code. Script can't read that redirect, so no script in the page ever sees the code
 */
export function handOffToNativeApp(accessToken: string): boolean {
  const challenge = readStoredValue(NATIVE_HANDOFF_KEY, 'session')
  if (!challenge) return false
  removeStoredValue(NATIVE_HANDOFF_KEY, 'session')

  const form = document.createElement('form')
  form.method = 'POST'
  form.action = `${API_BASE}/auth/native/handoff`
  for (const [name, value] of [['access_token', accessToken], ['code_challenge', challenge]]) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.append(input)
  }
  document.body.append(form)
  form.submit()
  return true
}
