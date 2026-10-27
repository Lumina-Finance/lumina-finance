import { expect, test } from '@playwright/test'

import { asUser, createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the page wiring is the same at every width, and the tooltip's placement is covered by disabled-reason.spec.ts

/**
 * Guards the Add transaction button on the list of every account. The create form offers only
 * unarchived accounts, so with none of them the button used to stay enabled and open a form with
 * nothing to choose. It is now held off with a reason, and works again once an account is open
 */
const ALL_ARCHIVED = 'All your accounts are archived: unarchive one or create an account first'
const NO_ACCOUNTS = 'Create an account first'

test('holds Add transaction off with a reason while every account is archived, and frees it with an open one', async ({ page, request }) => {
  const user = await signUpUser(request)
  const archivedAccount = await createAccount(request, user, { name: 'Everyday Chequing' })
  const archived = await request.patch(`${API_BASE_URL}/accounts/${archivedAccount.id}`, {
    headers: asUser(user),
    data: { is_archived: true },
  })
  expect(archived.status()).toBe(200)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const add = page.getByRole('button', { name: 'Add transaction', exact: true }).first()

  await expect(add).toHaveAttribute('aria-disabled', 'true')
  await expect(add).toHaveAccessibleDescription(ALL_ARCHIVED)

  // toBeDisabled passes for aria-disabled, so the press itself is made: a click, then Enter and Space
  await add.click({ force: true })
  await add.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The fence: with an open account the same button opens the form, so the presses above were refused for the reason
  await createAccount(request, user, { name: 'Savings' })
  await openPage(page, '/transactions')
  await expect(add).not.toHaveAttribute('aria-disabled', 'true')
  await add.click()
  await expect(page.getByRole('dialog', { name: 'Add transaction', exact: true })).toBeVisible()
})

test('says to create an account first while there are no accounts', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const add = page.getByRole('button', { name: 'Add transaction', exact: true }).first()

  await expect(add).toHaveAttribute('aria-disabled', 'true')
  await expect(add).toHaveAccessibleDescription(NO_ACCOUNTS)
})
