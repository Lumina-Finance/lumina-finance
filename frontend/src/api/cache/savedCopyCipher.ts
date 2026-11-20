// AES-GCM takes a nonce of 12 bytes, and must never see the same one twice under one key
const NONCE_BYTES = 12

const KEY_ALGORITHM = 'AES-GCM'

/** A saved copy as it is stored: the nonce it was sealed with and its ciphertext, both base64 */
export type SealedCopy = {
  nonce: string
  ciphertext: string
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0))
}

/**
 * Turns the key the server sent, as unpadded base64url, into a key the page can encrypt and decrypt
 * with but never read back out, so a script that runs on the page can use it only while the page lives
 *
 * Async so that text that isn't a key rejects, rather than throwing before any caller can catch it
 */
export async function importSavedCopyKey(encoded: string): Promise<CryptoKey> {
  const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/')
  const raw = decodeBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return await crypto.subtle.importKey('raw', raw, KEY_ALGORITHM, false, ['encrypt', 'decrypt'])
}

/**
 * Encrypts the text under a fresh random nonce, so two saves of the same text share no bytes
 */
export async function sealSavedCopy(key: CryptoKey, text: string): Promise<SealedCopy> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    { name: KEY_ALGORITHM, iv: nonce },
    key,
    new TextEncoder().encode(text),
  )
  return { nonce: encodeBase64(nonce), ciphertext: encodeBase64(new Uint8Array(ciphertext)) }
}

/**
 * Decrypts a sealed copy
 *
 * @throws When the key is not the one that sealed it or the stored bytes were changed. AES-GCM
 *   detects both
 */
export async function openSavedCopy(key: CryptoKey, sealed: SealedCopy): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: KEY_ALGORITHM, iv: decodeBase64(sealed.nonce) },
    key,
    decodeBase64(sealed.ciphertext),
  )
  return new TextDecoder().decode(plain)
}
