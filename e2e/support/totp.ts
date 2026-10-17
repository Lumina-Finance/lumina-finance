/**
 * An authenticator app for specs: enrols a user in TOTP over the API and computes their codes,
 * following RFC 6238 with the backend's parameters, so a spec can pass the second-factor step.
 */

import { createHmac } from 'node:crypto'

import type { APIRequestContext } from '@playwright/test'

import { asUser, type TestUser } from './api'
import { API_BASE_URL } from './target'

// The backend's TOTP parameters: six digits from HMAC-SHA1 over thirty-second steps
const TOTP_DIGITS = 6
const TOTP_PERIOD_SECONDS = 30

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function decodeBase32(secret: string): Buffer {
  let bits = ''
  for (const character of secret.replace(/=+$/, '').toUpperCase()) {
    const value = BASE32_ALPHABET.indexOf(character)
    if (value === -1) throw new Error(`the TOTP secret holds ${character}, which isn't base32`)
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes = bits.match(/.{8}/g) ?? []
  return Buffer.from(bytes.map((byte) => parseInt(byte, 2)))
}

function currentTotpStep(): number {
  return Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS)
}

function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const truncated = digest.readUInt32BE(offset) & 0x7fffffff
  return String(truncated % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}

/** The code an authenticator app shows for a secret right now */
export function currentTotp(secret: string): string {
  return totpAt(secret, currentTotpStep())
}

/**
 * Turn TOTP on for a user who has no second factor yet, the way the settings flow does.
 *
 * The backend refuses a code from a step at or before the last one it accepted, so enrolment
 * confirms with the previous step's code, which its window still accepts. That leaves the current
 * code free for the sign-in that follows, even when both fall in the same thirty seconds.
 *
 * @param request - Playwright request context
 * @param user - User to enrol, stepping up with their password
 * @returns The base32 secret an authenticator app would hold
 * @throws When any step of enrolment is refused
 */
export async function enrollTotp(request: APIRequestContext, user: TestUser): Promise<string> {
  const setup = await request.post(`${API_BASE_URL}/auth/2fa/setup`, {
    headers: asUser(user),
    data: { step_up: { password: user.password } },
  })
  if (!setup.ok()) throw new Error(`TOTP setup answered ${setup.status()}: ${await setup.text()}`)
  const { secret } = (await setup.json()) as { secret: string }

  const confirm = await request.post(`${API_BASE_URL}/auth/2fa/confirm`, {
    headers: asUser(user),
    data: { code: totpAt(secret, currentTotpStep() - 1) },
  })
  if (!confirm.ok()) throw new Error(`TOTP confirmation answered ${confirm.status()}: ${await confirm.text()}`)

  const complete = await request.post(`${API_BASE_URL}/auth/2fa/complete`, { headers: asUser(user) })
  if (!complete.ok()) throw new Error(`TOTP completion answered ${complete.status()}: ${await complete.text()}`)

  return secret
}
