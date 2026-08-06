/**
 * Driving the parts of the app a spec passes through on its way to the behaviour it tests.
 */

import { expect, type Locator, type Page } from '@playwright/test'

import type { TestUser } from './api'

// Covers a cold API call against a container that has just started
const CONTENT_TIMEOUT_MS = 20_000

// How long one attempt at opening a modal is given before the click is made again
const MODAL_ATTEMPT_MS = 3_000

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

/**
 * Open a modal from a toolbar button, and answer with the dialog.
 *
 * The create buttons do nothing but raise a toast until the currency list has arrived, so a
 * single click against a page that has just loaded opens nothing, and the wait that follows
 * blames the modal for a cause that sits in a request. Clicking again until the dialog appears
 * is what makes a spec independent of when that request settles.
 *
 * @param page - Page showing the toolbar
 * @param buttonName - Accessible name of the button that opens the modal, matched exactly
 * @param dialogName - Accessible name of the dialog it opens
 * @returns The dialog, to scope every query inside it
 */
export async function openModal(page: Page, buttonName: string, dialogName: string): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: dialogName })

  await expect(async () => {
    if (!(await dialog.isVisible())) {
      // Bounded, because a modal that opens between the check above and this click puts its
      // backdrop over the button. Without a timeout that click waits out the whole test rather
      // than failing and letting the next attempt see the dialog is already open
      await page.getByRole('button', { name: buttonName, exact: true }).click({ timeout: MODAL_ATTEMPT_MS })
    }
    await expect(dialog).toBeVisible({ timeout: MODAL_ATTEMPT_MS })
  }).toPass({ timeout: CONTENT_TIMEOUT_MS })

  return dialog
}

/**
 * Pick an option from one of the app's dropdowns.
 *
 * The dropdown is a button that opens a listbox rather than a native select, so this is two
 * clicks. The listbox renders inside the dropdown rather than at the top of the document, which
 * is why the options are found within the same scope.
 *
 * @param scope - Dialog or page holding the field
 * @param fieldName - Accessible name of the dropdown
 * @param optionName - Accessible name of the option to pick
 */
export async function chooseFromDropdown(
  scope: Locator,
  fieldName: string,
  optionName: string | RegExp,
): Promise<void> {
  await scope.getByRole('combobox', { name: fieldName }).click()
  await scope.getByRole('option', { name: optionName }).click()
}
