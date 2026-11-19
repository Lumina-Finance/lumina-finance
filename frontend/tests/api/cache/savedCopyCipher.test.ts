/**
 * Guards the cipher the saved copy rests on: whatever key the server sends, in the url form that
 * holds the characters plain base64 would write differently, and whatever text is saved, it comes
 * back with the key that sealed it and is refused to any other, and the page can never read its key
 * back out
 */
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { importSavedCopyKey, openSavedCopy, sealSavedCopy } from '@/api/cache/savedCopyCipher'
import { toBase64Url } from '@tests/api/cache/fixtures'

// Random bytes, and bytes whose base64 is mostly the two characters the url form replaces
const keyBytes = fc.oneof(
  fc.uint8Array({ minLength: 32, maxLength: 32 }),
  fc.uint8Array({ minLength: 32, maxLength: 32 }).map((bytes) => bytes.map((byte) => byte | 0xe0)),
)

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.every((byte, index) => byte === b[index])

it('gives any text back to the key that sealed it, and refuses every other key', async () => {
  await fc.assert(
    fc.asyncProperty(keyBytes, keyBytes, fc.string({ unit: 'grapheme' }), async (sealing, other, text) => {
      fc.pre(!sameBytes(sealing, other))
      const sealed = await sealSavedCopy(await importSavedCopyKey(toBase64Url(sealing)), text)

      expect(await openSavedCopy(await importSavedCopyKey(toBase64Url(sealing)), sealed)).toBe(text)
      await expect(openSavedCopy(await importSavedCopyKey(toBase64Url(other)), sealed)).rejects.toThrow()
    }),
  )
})

it('seals the same text differently each time', async () => {
  const key = await importSavedCopyKey(toBase64Url(new Uint8Array(32).fill(0xfb)))

  const first = await sealSavedCopy(key, 'the same text')
  const second = await sealSavedCopy(key, 'the same text')

  expect(second.nonce).not.toBe(first.nonce)
  expect(second.ciphertext).not.toBe(first.ciphertext)
})

it('imports a key the page can not read back out', async () => {
  const key = await importSavedCopyKey(toBase64Url(new Uint8Array(32).fill(0xfb)))

  expect(key.extractable).toBe(false)
  await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow()
})

it('rejects text that is no key', async () => {
  await expect(importSavedCopyKey('!!! not a key')).rejects.toThrow()
})
