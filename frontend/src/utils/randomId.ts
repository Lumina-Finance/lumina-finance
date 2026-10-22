/**
 * Makes a random id for telling items apart on the page
 *
 * Uses getRandomValues, which a page on plain HTTP has, rather than crypto.randomUUID, which a
 * browser offers only on HTTPS or localhost
 */
export function createRandomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
