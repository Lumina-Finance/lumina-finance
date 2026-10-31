/**
 * Reading the email the instance sent, from the mail catcher it delivers to.
 *
 * Sign-up creates no account until the emailed link is opened, so a spec that needs a user
 * fetches that link here. The catcher is Mailpit, and its API lists mail by recipient. Every
 * spec signs up an address of its own, so reading by recipient never meets another spec's mail.
 */

import { MAIL_API_URL } from './target'

const MAIL_POLL_MS = 250
const MAIL_TIMEOUT_MS = 20_000

interface MailSummary {
  ID: string
}

interface MailMessage {
  Text: string
}

/**
 * Get the mail catcher's address, or say how to supply it.
 */
function mailApiUrl(): string {
  if (MAIL_API_URL === undefined) {
    throw new Error('E2E_MAIL_API_URL is required to read sign-up emails, as E2E_MAIL_API_URL=http://127.0.0.1:8025')
  }
  return MAIL_API_URL
}

/**
 * Wait for the newest email sent to an address and return its plain-text body.
 *
 * @param email - The recipient address
 * @param matching - Text the body must match, for an address that has been sent other mail already
 * @returns The text of the newest message sent to that address, and matching when given
 * @throws When nothing arrives within the timeout
 */
export async function waitForEmailText(email: string, matching?: RegExp): Promise<string> {
  const base = mailApiUrl()
  const deadline = Date.now() + MAIL_TIMEOUT_MS

  while (Date.now() < deadline) {
    const search = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
    // A catcher that answers with an error is down or misconfigured, which waiting longer will not fix
    if (!search.ok) {
      throw new Error(`the mail catcher at ${base} answered ${search.status} to a search for ${email}`)
    }
    const { messages } = (await search.json()) as { messages: MailSummary[] }
    // The catcher lists the newest first
    for (const { ID } of messages) {
      const message = await fetch(`${base}/api/v1/message/${ID}`)
      if (!message.ok) break
      const { Text } = (await message.json()) as MailMessage
      if (matching === undefined || matching.test(Text)) return Text
    }
    await new Promise((resolve) => setTimeout(resolve, MAIL_POLL_MS))
  }

  throw new Error(`no email arrived for ${email} within ${MAIL_TIMEOUT_MS / 1000}s`)
}

/**
 * Count the emails the catcher holds for an address.
 *
 * @param email - The recipient address
 * @returns How many messages were sent to that address
 */
export async function countEmailsTo(email: string): Promise<number> {
  const base = mailApiUrl()
  const search = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
  if (!search.ok) {
    throw new Error(`the mail catcher at ${base} answered ${search.status} to a search for ${email}`)
  }
  return ((await search.json()) as { messages: MailSummary[] }).messages.length
}

/**
 * Wait for the sign-up confirmation email to an address and return the link it holds.
 *
 * @param email - The address that asked to sign up
 * @returns The confirmation link as the app emailed it
 * @throws When no email arrives, or the one that does holds no confirmation link
 */
export async function waitForConfirmationLink(email: string): Promise<string> {
  const text = await waitForEmailText(email)
  const link = /https?:\/\/\S+\/confirm-email\?token=\S+/.exec(text)
  if (link === null) {
    throw new Error(`the email to ${email} holds no confirmation link`)
  }
  return link[0]
}

/**
 * Wait for the password reset email to an address and return the link it holds.
 *
 * The address has already been sent its sign-up email, so only a message holding a reset link counts
 *
 * @param email - The address that asked for a reset
 * @returns The reset link as the app emailed it
 * @throws When no reset email arrives
 */
export async function waitForResetLink(email: string): Promise<string> {
  const resetLink = /https?:\/\/\S+\/reset-password\?token=\S+/
  const text = await waitForEmailText(email, resetLink)
  return resetLink.exec(text)![0]
}

/**
 * Pull the token out of a confirmation link.
 */
export function tokenFromLink(link: string): string {
  const token = new URL(link).searchParams.get('token')
  if (token === null) {
    throw new Error(`no token in ${link}`)
  }
  return token
}
