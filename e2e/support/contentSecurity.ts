/**
 * Catching what the server's Content Security Policy blocks in a page
 *
 * The browser reports a blocked script, style, image, font or request as an error in its console, and
 * the page carries on without it. A flow can therefore look finished while part of it was refused, so
 * a test that must prove the policy leaves a flow whole reads the console as well as the screen
 */

import type { BrowserContext } from '@playwright/test'

// The wording the browser puts in every message about the policy, whichever directive refused
const POLICY_MESSAGE = /Content Security Policy/i

/**
 * Starts recording the policy's refusals in every page of a context, popups included
 *
 * @param context - The browser context the test's pages belong to
 * @returns The messages recorded so far. The array keeps growing as the pages run, and a test asserts
 *   it is empty after the flow it checks
 */
export function recordPolicyViolations(context: BrowserContext): string[] {
  const violations: string[] = []
  context.on('console', (message) => {
    if (message.type() === 'error' && POLICY_MESSAGE.test(message.text())) violations.push(message.text())
  })
  return violations
}
