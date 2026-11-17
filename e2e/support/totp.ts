/**
 * An authenticator app for specs: enrols a user in TOTP over the API and computes their codes,
 * following RFC 6238 with the backend's parameters, so a spec can pass the second-factor step.
 */

import { createHmac } from 'node:crypto'

import { expect, type APIRequestContext } from '@playwright/test'

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

// The backend accepts a code from the step before the one its own clock is in, and no older. A code worked out
// for the previous step, but sent as the step ends, reaches it two steps old. So no code is worked out for
// confirming within this long of a step's end. A request takes far less than this on a busy runner
const TOTP_STEP_END_MARGIN_MS = 3_000

/** Waits, when a step is about to end, for the next one to begin, so a code worked out now is sent within its window */
async function waitForSafeStepPosition(): Promise<void> {
  const stepLengthMs = TOTP_PERIOD_SECONDS * 1000
  await expect
    .poll(() => stepLengthMs - (Date.now() % stepLengthMs) > TOTP_STEP_END_MARGIN_MS, {
      timeout: TOTP_STEP_END_MARGIN_MS + 2_000,
      intervals: [250],
    })
    .toBe(true)
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
 * code free for the sign-in that follows, even when both fall in the same thirty seconds. Near the end of a
 * step it first waits for the next, since the window no longer holds a code that is then two steps old.
 *
 * @param request - Playwright request context
 * @param user - User to enrol, stepping up with their password
 * @returns The base32 secret an authenticator app would hold
 * @throws When any step of enrolment is refused
 */
export async function enrollTotp(request: APIRequestContext, user: TestUser): Promise<string> {
  return (await enrollTotpWithRecoveryCodes(request, user)).secret
}

/**
 * Turn TOTP on as `enrollTotp` does, keeping the recovery codes the server shows once.
 *
 * @param request - Playwright request context
 * @param user - User to enrol, stepping up with their password
 * @returns The base32 secret an authenticator app would hold and the plaintext recovery codes
 * @throws When any step of enrolment is refused
 */
export async function enrollTotpWithRecoveryCodes(
  request: APIRequestContext,
  user: TestUser,
): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setup = await request.post(`${API_BASE_URL}/auth/2fa/setup`, {
    headers: asUser(user),
    data: { step_up: { password: user.password } },
  })
  if (!setup.ok()) throw new Error(`TOTP setup answered ${setup.status()}: ${await setup.text()}`)
  const { secret } = (await setup.json()) as { secret: string }

  await waitForSafeStepPosition()
  const confirm = await request.post(`${API_BASE_URL}/auth/2fa/confirm`, {
    headers: asUser(user),
    data: { code: totpAt(secret, currentTotpStep() - 1) },
  })
  if (!confirm.ok()) throw new Error(`TOTP confirmation answered ${confirm.status()}: ${await confirm.text()}`)
  const { recovery_codes: recoveryCodes } = (await confirm.json()) as { recovery_codes: string[] }

  const complete = await request.post(`${API_BASE_URL}/auth/2fa/complete`, { headers: asUser(user) })
  if (!complete.ok()) throw new Error(`TOTP completion answered ${complete.status()}: ${await complete.text()}`)

  return { secret, recoveryCodes }
}
