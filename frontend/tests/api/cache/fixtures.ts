import type { AuthResponse } from '@/api/auth/types'

type SavedCopySession = Pick<AuthResponse, 'saved_copy_key' | 'saved_copy_key_version'> & {
  user: Pick<AuthResponse['user'], 'id'>
}

/** A key as the server sends it: unpadded base64url */
export function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

// Bytes whose base64 holds both of the characters the url form replaces, so a key decoded as plain
// base64 fails the tests that use it. Each of these gives a key with a different base64url text
export const KEY_FILL = 0xfb
export const OTHER_KEY_FILL = 0xef

/**
 * The user and key fields of a browser's session response
 *
 * @param keyNumber - The user's key number
 * @param fill - The byte every byte of the 32-byte key repeats, so two values give two keys
 * @param userId - The user the session belongs to
 */
export function savedCopySession(keyNumber = 0, fill = KEY_FILL, userId = 'user-a'): SavedCopySession {
  return {
    user: { id: userId },
    saved_copy_key: toBase64Url(new Uint8Array(32).fill(fill)),
    saved_copy_key_version: keyNumber,
  }
}
