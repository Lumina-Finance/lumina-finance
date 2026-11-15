import { expect, test } from '@playwright/test'

import { asUser, createAccount, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage } from '../support/app'
import { linkBankAccount, reviewBlock, waitForReviewItems, type SeededConnection } from '../support/bankSync'
import { NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { createSamplePluggyScenario, isPluggyOffered } from '../support/pluggy'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the connect dialogue and the review block take the same steps at every size,
// and the SimpleFIN specs already measure them

// Pluggy's provider folder can be deleted to remove it from the app, so this spec runs only
// where the server offers it. Its keys come from the fake Pluggy the instance syncs with, and the
// worker imports the sample scenario's transactions for review, so nothing here is answered in the
// server's place
const SAMPLE_CHECKING = 'Conta Corrente'

// The sample checking account's transactions from 9, 5 and 2 days ago, all of them within an import from 10 days
// back
const SAMPLE_DESCRIPTIONS = ['COMPRA DEBITO POSTO NORTE', 'SALARIO BRIGHTWORKS LTDA', 'COMPRA DEBITO PADARIA SOL NASCENTE']

test('connects Pluggy with an application and an item, links an account and shows an imported transaction for review', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  test.skip(!(await isPluggyOffered(request, user)), 'Pluggy is not installed on this server')
  const everyday = await createAccount(request, user, { name: 'Everyday', currency: 'BRL' })
  const scenario = await createSamplePluggyScenario(request)

  await logInViaApi(page, user)
  await openPage(page, '/settings#bank-connections')
  const section = page.locator('#bank-connections')
  await section.getByRole('button', { name: 'Add a connection' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a connection' })
  await chooseFromDropdown(dialog, 'Provider', /^Pluggy/)
  await expect(dialog.getByRole('combobox', { name: 'Provider' })).toContainText('PluggyBeta')
  await dialog.getByRole('textbox', { name: 'Client ID' }).fill(scenario.clientId)
  await dialog.getByRole('textbox', { name: 'Client secret' }).fill(scenario.clientSecret)
  await dialog.getByRole('textbox', { name: 'Item IDs' }).fill(scenario.itemId)
  await dialog.getByRole('button', { name: 'Connect' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Connected to Pluggy with 2 bank accounts.' })).toBeVisible()
  await expect(dialog).toBeHidden()

  const listed = await request.get(`${API_BASE_URL}/bank-sync/connections`, { headers: asUser(user) })
  expect(listed.status()).toBe(200)
  const [connection] = (await listed.json()) as SeededConnection[]
  const checking = connection.accounts.find((bankAccount) => bankAccount.name === SAMPLE_CHECKING)!
  await linkBankAccount(request, user, {
    accountId: everyday.id,
    connectionId: connection.id,
    externalAccountId: checking.external_id,
    startDate: daysFromTodayInTestTimezone(-10),
  })
  await waitForReviewItems(request, user, everyday.id, (items) => items.length === SAMPLE_DESCRIPTIONS.length)

  await openPage(page, '/transactions')
  for (const description of SAMPLE_DESCRIPTIONS) {
    await expect(reviewBlock(page).getByRole('button', { name: description })).toBeVisible()
  }
})
