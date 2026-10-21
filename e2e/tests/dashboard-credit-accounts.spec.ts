import { expect, test, type Page } from '@playwright/test'

import { createAccount, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs at every size: the choice opens a dialog that fills the screen on a phone, and the widget header
// carries its button at every width

const CHOOSE_BUTTON = 'Choose credit accounts'
const EMPTY_STATE_BUTTON = 'Choose a credit account'

/**
 * The dashboard's content, which a fresh user's other widgets leave without any percentage, so a
 * percentage found in it is the credit widget's
 */
function dashboardContent(page: Page) {
  return page.getByRole('main')
}

/** Create a credit card in the test currency with an amount used and a limit, in minor units */
async function createCard(request: Parameters<typeof createAccount>[0], user: TestUser, name: string, used: number, limit: number) {
  return createAccount(request, user, {
    name,
    accountKind: 'revolving',
    accountType: 'credit_card',
    startingBalance: -used,
    creditLimit: limit,
  })
}

/** Open the chooser from the widget header and return its dialog */
async function openChooser(page: Page, from: 'header' | 'empty state' = 'header') {
  await page.getByRole('button', { name: from === 'header' ? CHOOSE_BUTTON : EMPTY_STATE_BUTTON }).click()
  return page.getByRole('dialog', { name: 'Credit utilization' })
}

test('leaves a card out of the credit widget by keyboard, keeps the choice on a fresh load, and counts a later card', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  await createCard(request, user, 'Card A', 50_000, 500_000)
  await createCard(request, user, 'Card B', 150_000, 200_000)

  await logInViaApi(page, user)
  await openPage(page, '/dashboard')

  // Both cards count at first: 2,000 used of 7,000 is about 29%
  await expect(dashboardContent(page)).toContainText('29%')

  const dialog = await openChooser(page)
  const cardB = dialog.getByRole('checkbox', { name: 'Card B' })
  await expect(dialog.getByRole('checkbox', { name: 'Card A' })).toHaveAttribute('aria-checked', 'true')
  await expect(cardB).toHaveAttribute('aria-checked', 'true')

  await cardB.focus()
  await page.keyboard.press('Space')
  await expect(cardB).toHaveAttribute('aria-checked', 'false')
  await dialog.getByRole('button', { name: 'Save' }).click()

  // Only Card A is left: 500 used of 5,000 is 10%
  await expect(dialog).toBeHidden()
  await expect(dashboardContent(page)).toContainText('10%')

  // A fresh load stands in for opening the dashboard on another device, and a card added since counts
  await createCard(request, user, 'Card C', 100_000, 100_000)
  await openPage(page, '/dashboard')
  const reopened = await openChooser(page)
  await expect(reopened.getByRole('checkbox', { name: 'Card A' })).toHaveAttribute('aria-checked', 'true')
  await expect(reopened.getByRole('checkbox', { name: 'Card B' })).toHaveAttribute('aria-checked', 'false')
  await expect(reopened.getByRole('checkbox', { name: 'Card C' })).toHaveAttribute('aria-checked', 'true')
})

test('shows its own empty state once every card is left out, and brings a card back from the chooser', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  await createCard(request, user, 'Card A', 50_000, 500_000)
  await createCard(request, user, 'Card B', 150_000, 200_000)

  await logInViaApi(page, user)
  await openPage(page, '/dashboard')
  const dialog = await openChooser(page)
  await dialog.getByRole('checkbox', { name: 'Card A' }).click()
  await dialog.getByRole('checkbox', { name: 'Card B' }).click()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  // The choice is on the server, so a fresh load shows the same state with the way back still in the header
  await openPage(page, '/dashboard')
  await expect(page.getByText('No accounts selected')).toBeVisible()
  await expect(page.getByText('Choose a credit account to get started')).toBeVisible()
  await expect(page.getByText('No credit accounts')).toBeHidden()

  // The empty state's own button opens the same chooser as the header's
  const reopened = await openChooser(page, 'empty state')
  await reopened.getByRole('checkbox', { name: 'Card B' }).click()
  await reopened.getByRole('button', { name: 'Save' }).click()
  await expect(reopened).toBeHidden()

  // Card B alone is 1,500 used of 2,000
  await expect(dashboardContent(page)).toContainText('75%')
  await expect(page.getByText('No accounts selected')).toBeHidden()
})
