/**
 * Driving the parts of the app a spec passes through on its way to the behaviour it tests.
 */

import type { Page } from '@playwright/test'

import type { TestUser } from './api'

// Covers a cold API call against a container that has just started
const CONTENT_TIMEOUT_MS = 20_000

/**
 * Sign in through the login form and wait until the app leaves the login page.
 *
 * Leaving the page is all this waits for. Whether the page it lands on has its data is for
 * the spec to assert, since there is no signal in the app that would answer it generally.
 *
 * @param page - Page to drive, at any address in the app
 * @param user - Credentials to sign in with
 */
export async function logIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)

  // Exact, or it also matches the "Confirm password" field the signup form carries
  await page.getByLabel('Password', { exact: true }).fill(user.password)

  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: CONTENT_TIMEOUT_MS })
}
