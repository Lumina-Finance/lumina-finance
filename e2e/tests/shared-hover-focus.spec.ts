import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { contrastRatio, shownFill } from '../support/paint'

// Runs on desktop only: hover, keyboard focus and the sidebar's collapse are the desktop's states, and the
// colours and easing they check don't vary with width

/**
 * Guards the hover, focus and motion rules shared across screens, which each used to leave a control
 * showing nothing under the pointer or the keyboard in one theme
 */

const NAV_EXPANDED_KEY = 'lumina:settings:navExpanded'

// The smallest step between a surface and the same surface under the pointer that shows
const MINIMUM_HOVER_STEP = 1.05

/** Signs up a user, opens a page in a theme and pins the sidebar open, so its controls are on screen */
async function openAs(page: Page, request: Parameters<typeof signUpUser>[0], colorScheme: 'light' | 'dark', url: string) {
  await page.emulateMedia({ colorScheme })
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await page.addInitScript((key) => localStorage.setItem(key, 'true'), NAV_EXPANDED_KEY)
  await openPage(page, url)
  await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
}

/** How far an element's colour on screen steps when the pointer comes onto it, as a contrast ratio */
async function hoverStep(page: Page, element: Locator): Promise<number> {
  await page.mouse.move(0, 0)
  const rest = await shownFill(element)
  await element.hover()
  await expect.poll(async () => contrastRatio(rest, await shownFill(element))).toBeGreaterThan(1)
  return contrastRatio(rest, await shownFill(element))
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`shows a hover on the Insights category list in the ${colorScheme} theme`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme })
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday chequing', startingBalance: 100_000 })
    await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 300_000 })
    await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -20_000 })
    await logInViaApi(page, user)
    await openPage(page, '/insights')

    // The list's header, and a category row once it opens, sit on the card
    const header = page.getByRole('button', { name: /^Toggle / }).first()
    await header.click()
    const row = page.locator(`#${await header.getAttribute('aria-controls')}`).getByText(/^(Salary|Groceries)$/).first()
    expect(await hoverStep(page, header)).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)
    expect(await hoverStep(page, row)).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)
  })

  test(`shows a hover on the sidebar's log out button and a settings card row in the ${colorScheme} theme`, async ({ page, request }) => {
    await openAs(page, request, colorScheme, '/settings')

    const logOut = page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('button', { name: 'Log out', exact: true })
    expect(await hoverStep(page, logOut)).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)

    const expenseGroup = page.getByRole('button', { name: /^Expense/ }).first()
    expect(await hoverStep(page, expenseGroup)).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)
  })
}
