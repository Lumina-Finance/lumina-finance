/**
 * Driving the parts of the app a spec passes through on its way to the behaviour it tests.
 */

import { expect, type Locator, type Page } from '@playwright/test'

import type { TestUser } from './api'
import { API_BASE_URL } from './target'

// The app's own two breakpoints. Above the first the navigation is a sidebar and below it a
// menu behind a button. Above the second the list toolbars show their controls inline, and
// below it a reduced set that opens filtering in a sheet
const NAVIGATION_BREAKPOINT_PX = 1050
const TOOLBAR_BREAKPOINT_PX = 750

/**
 * Whether the page is at least this wide, as the app's own media queries see it.
 *
 * Asked of the page rather than worked out from the configured viewport, because a classic
 * scrollbar takes its width out of the layout viewport, so the two numbers differ by fifteen
 * on any project that draws one.
 *
 * @param page - Page to measure
 * @param widthPx - Width to compare against
 * @returns Whether the app's layout is at or above that width
 */
async function isAtLeast(page: Page, widthPx: number): Promise<boolean> {
  return page.evaluate((px) => matchMedia(`(min-width: ${px}px)`).matches, widthPx)
}

/**
 * Sign in through the login form and wait until the app leaves the login page.
 *
 * Waits for the response and route transition separately from assertions on page data
 *
 * @param page - Page to drive, at any address in the app
 * @param user - Credentials to sign in with
 */
export async function logIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)

  // Exact, or it also matches the "Confirm password" field the signup form carries
  await page.getByLabel('Password', { exact: true }).fill(user.password)

  const authenticated = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/auth/login` && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Log in' }).click()
  expect((await authenticated).status()).toBe(200)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await waitForPageReady(page)
}

/** Wait for a new document or an identified destination route to finish its entrance */
export async function waitForPageReady(page: Page): Promise<void> {
  await page.locator('#app-page-content[aria-busy="false"]').waitFor({ state: 'visible' })
}

/** Navigate to an authenticated page and wait for its actual route readiness signal */
export async function openPage(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await waitForPageReady(page)
}

/**
 * Assert the app is showing its signed-in shell.
 *
 * The navigation is the thing that says so, and it only renders for a signed-in user past the
 * boot splash. Which half of it to read depends on the width: the sidebar carries the links
 * themselves, while the menu keeps them behind a button and mounts them only once it is open.
 *
 * @param page - Page to assert on
 */
export async function expectSignedIn(page: Page): Promise<void> {
  await waitForPageReady(page)
  const signedIn = (await isAtLeast(page, NAVIGATION_BREAKPOINT_PX))
    ? page.getByRole('link', { name: 'Accounts' })
    : page.getByRole('button', { name: 'Open navigation menu' })

  await expect(signedIn).toBeVisible()
}

/**
 * Filter the transaction list down to one category, and apply it.
 *
 * Two different control sets do this job. Above the toolbar breakpoint it is a pill that opens
 * a panel of tabs; below it a sheet whose first control is a dropdown rather than tabs, and
 * that dropdown is named by the sheet's Filters heading
 *
 * @param page - Page showing the transaction list
 * @param categoryName - Exact name of the category to keep
 */
export async function filterByCategory(page: Page, categoryName: string): Promise<void> {
  if (await isAtLeast(page, TOOLBAR_BREAKPOINT_PX)) {
    await page.getByRole('button', { name: 'Transaction filters' }).click()
    await page.getByRole('tab', { name: 'Category' }).click()
    await page.getByRole('checkbox', { name: categoryName }).click()
    await page.getByRole('button', { name: 'Apply filters' }).click()
    return
  }

  await page.getByRole('button', { name: 'Filters', exact: true }).click()

  const sheet = page.getByRole('dialog', { name: 'Transaction filters' })
  await sheet.getByRole('combobox', { name: 'Filters', exact: true }).click()
  await sheet.getByRole('option', { name: 'Category' }).click()
  await sheet.getByRole('checkbox', { name: categoryName }).click()
  await sheet.getByRole('button', { name: 'Apply filters' }).click()
}

/**
 * Open a modal from a toolbar button, and answer with the dialog.
 *
 * The authenticated route waits for currencies before becoming ready, so the opener can be
 * clicked once after the route finishes loading
 *
 * @param page - Page showing the toolbar
 * @param buttonNames - Accessible names of the button that opens the modal, one per toolbar,
 *   since the reduced toolbar below the breakpoint calls the same control something else
 * @param dialogName - Accessible name of the dialog it opens
 * @returns The dialog, to scope every query inside it
 */
export async function openModal(page: Page, buttonNames: string[], dialogName: string): Promise<Locator> {
  await waitForPageReady(page)
  const dialog = page.getByRole('dialog', { name: dialogName })

  // Only one toolbar is ever displayed, so only one of these names is in the accessibility
  // tree and the pair resolves to a single control at any width
  //
  // Anything inside an open dialog is excluded, because the transaction modal's own submit
  // button carries the same name as the toolbar button that opened it
  const outsideDialogs = page.locator(':not([role="dialog"] *)')
  const opener = buttonNames
    .map((name) => page.getByRole('button', { name, exact: true }).and(outsideDialogs))
    .reduce((all, one) => all.or(one))

  await opener.click()
  await expect(dialog).toBeVisible()

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
