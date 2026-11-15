import { expect, test } from '@playwright/test'

import { createSampleAkahuScenario, isAkahuOffered } from '../support/akahu'
import { asUser, createAccount, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage } from '../support/app'
import { linkBankAccount, reviewBlock, waitForReviewItems, type SeededConnection } from '../support/bankSync'
import { NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the connect dialogue and the review block take the same steps at every size,
// and the SimpleFIN specs already measure them

// Akahu's provider folder can be deleted to remove it from the app, so this spec runs only
// where the server offers it. Its tokens come from the fake Akahu the instance syncs with, and the
// worker imports the sample scenario's transactions for review, so nothing here is answered in the
// server's place
const SAMPLE_CHEQUING = 'Everyday Chequing'

// The sample chequing account's transactions from 9, 5 and 2 days ago, all of them within an import from 10 days
// back
const SAMPLE_DESCRIPTIONS = ['EFTPOS NORTHERN FUEL STOP', 'DIRECT CREDIT BRIGHTWORKS LTD SALARY', 'EFTPOS BEAN THERE CAFE']

test('connects Akahu with a personal app, links an account and shows an imported transaction for review', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  test.skip(!(await isAkahuOffered(request, user)), 'Akahu is not installed on this server')
  const everyday = await createAccount(request, user, { name: 'Everyday', currency: 'NZD' })
  const scenario = await createSampleAkahuScenario(request)

  await logInViaApi(page, user)
  await openPage(page, '/settings#bank-connections')
  const section = page.locator('#bank-connections')
  await section.getByRole('button', { name: 'Add a connection' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a connection' })
  await chooseFromDropdown(dialog, 'Provider', /^Akahu/)
  await expect(dialog.getByRole('combobox', { name: 'Provider' })).toContainText('AkahuBeta')
  await dialog.getByRole('textbox', { name: 'App ID token' }).fill(scenario.appIdToken)
  await dialog.getByRole('textbox', { name: 'User access token' }).fill(scenario.userAccessToken)
  await dialog.getByRole('button', { name: 'Connect' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Connected to Akahu with 2 bank accounts.' })).toBeVisible()
  await expect(dialog).toBeHidden()

  const listed = await request.get(`${API_BASE_URL}/bank-sync/connections`, { headers: asUser(user) })
  expect(listed.status()).toBe(200)
  const [connection] = (await listed.json()) as SeededConnection[]
  const chequing = connection.accounts.find((bankAccount) => bankAccount.name === SAMPLE_CHEQUING)!
  await linkBankAccount(request, user, {
    accountId: everyday.id,
    connectionId: connection.id,
    externalAccountId: chequing.external_id,
    startDate: daysFromTodayInTestTimezone(-10),
  })
  await waitForReviewItems(request, user, everyday.id, (items) => items.length === SAMPLE_DESCRIPTIONS.length)

  await openPage(page, '/transactions')
  for (const description of SAMPLE_DESCRIPTIONS) {
    await expect(reviewBlock(page).getByRole('button', { name: description })).toBeVisible()
  }
})
