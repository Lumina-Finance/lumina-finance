import { expect, test, type Locator } from '@playwright/test'

import { asUser, createAccount, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage } from '../support/app'
import {
  errorToast,
  linkBankAccount,
  openBankLink,
  reviewBlock,
  syncBankLinkNow,
  waitForConnection,
  waitForReviewItems,
  type SeededConnection,
} from '../support/bankSync'
import { NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import {
  createSampleEnableBankingScenario,
  expireEnableBankingSessions,
  isEnableBankingOffered,
  type FakeEnableBankingScenario,
} from '../support/enableBanking'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the connect dialogue and the review block take the same steps at every size,
// and the SimpleFIN specs already measure them

// Enable Banking's provider folder can be deleted to remove it from the app, so this spec runs only
// where the server offers it. Its application comes from the fake Enable Banking the instance syncs
// with. The browser goes to the fake bank's page and back as it would to a real bank, and the worker
// imports the sample scenario's transactions for review, so nothing here is answered in the server's place
const SAMPLE_CHECKING = 'Everyday'

// What the user is told when they decline at the bank, wherever the sign-in started
const DECLINED_MESSAGE = "Nothing was added: your bank didn't approve access."

// The sample checking account's transactions from 9, 5 and 2 days ago, all of them within an import from 10 days back
const SAMPLE_DESCRIPTIONS = ['CARD PURCHASE STATION NORTH', 'SALARY BRIGHTWORKS OY', 'CARD PURCHASE BAKERY SOL']

// Drops a file onto a field as the browser does when one is dragged from the desktop
async function dropFile(field: Locator, name: string, contents: string) {
  const dataTransfer = await field.page().evaluateHandle(
    ([fileName, fileContents]) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([fileContents], fileName))
      return transfer
    },
    [name, contents] as const,
  )
  for (const type of ['dragenter', 'dragover', 'drop']) await field.dispatchEvent(type, { dataTransfer })
}

// The private key arrives as the .pem file Enable Banking's Control Panel saves, dropped onto its masked
// field. A password input has no textbox role, so the test finds that field by its label
async function fillConnectForm(dialog: Locator, scenario: FakeEnableBankingScenario, bank = scenario.bank) {
  await chooseFromDropdown(dialog, 'Provider', /^Enable Banking/)
  await dialog.getByRole('textbox', { name: 'Application ID' }).fill(scenario.applicationId)
  const privateKey = dialog.getByLabel('Private key', { exact: true })
  await expect(privateKey).toHaveAttribute('type', 'password')
  await dropFile(privateKey, `${scenario.applicationId}.pem`, scenario.privateKey)
  await expect(privateKey).toHaveValue(/-----BEGIN (RSA )?PRIVATE KEY-----/)
  await dialog.getByRole('textbox', { name: 'Country' }).fill(scenario.country)
  await dialog.getByRole('textbox', { name: 'Bank' }).fill(bank)
  await dialog.getByRole('button', { name: 'Go to your bank' }).click()
}

test('refuses a dropped file of another kind, then marks only Country and Bank for a bank Enable Banking does not list', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  test.skip(!(await isEnableBankingOffered(request, user)), 'Enable Banking is not installed on this server')
  const scenario = await createSampleEnableBankingScenario(request)

  await logInViaApi(page, user)
  await openPage(page, '/settings#bank-connections')
  await page.locator('#bank-connections').getByRole('button', { name: 'Add a connection' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a connection' })
  await chooseFromDropdown(dialog, 'Provider', /^Enable Banking/)
  const privateKey = dialog.getByLabel('Private key', { exact: true })
  await dropFile(privateKey, 'notes.txt', 'hello')
  await expect(dialog.getByText('Please drop a .pem file')).toBeVisible()
  await expect(privateKey).toHaveAttribute('aria-invalid', 'true')
  await expect(privateKey).toHaveValue('')

  await fillConnectForm(dialog, scenario, 'Nowhere Bank')

  await expect(dialog.getByText(`We couldn't find "Nowhere Bank" in ${scenario.country} on Enable Banking`)).toBeVisible()
  for (const name of ['Country', 'Bank']) {
    await expect(dialog.getByRole('textbox', { name, exact: true })).toHaveAttribute('aria-invalid', 'true')
  }
  await expect(dialog.getByRole('textbox', { name: 'Application ID' })).not.toHaveAttribute('aria-invalid', 'true')
  await expect(privateKey).not.toHaveAttribute('aria-invalid', 'true')
  await expect(page).toHaveURL(/\/settings#bank-connections$/)
})

test('connects a bank after signing in at it, links an account and shows an imported transaction for review', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  test.skip(!(await isEnableBankingOffered(request, user)), 'Enable Banking is not installed on this server')
  const everyday = await createAccount(request, user, { name: 'Everyday', currency: 'EUR' })
  const scenario = await createSampleEnableBankingScenario(request)

  await logInViaApi(page, user)
  await openPage(page, '/settings#bank-connections')
  const section = page.locator('#bank-connections')
  await section.getByRole('button', { name: 'Add a connection' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a connection' })
  await fillConnectForm(dialog, scenario)

  // Away at the bank, then back through the return page to Bank connections
  await page.getByRole('link', { name: 'Share my accounts' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Connected to Enable Banking with 2 bank accounts.' })).toBeVisible()
  await expect(page).toHaveURL(/\/settings#bank-connections$/)

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

test('reconnects through the bank once the sign-in ends, and the linked account resumes', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  test.skip(!(await isEnableBankingOffered(request, user)), 'Enable Banking is not installed on this server')
  const everyday = await createAccount(request, user, { name: 'Everyday', currency: 'EUR' })
  const scenario = await createSampleEnableBankingScenario(request)

  await logInViaApi(page, user)
  await openPage(page, '/settings#bank-connections')
  const section = page.locator('#bank-connections')
  await section.getByRole('button', { name: 'Add a connection' }).click()
  await fillConnectForm(page.getByRole('dialog', { name: 'Add a connection' }), scenario)
  await page.getByRole('link', { name: 'Share my accounts' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Connected to Enable Banking' })).toBeVisible()

  const listed = await request.get(`${API_BASE_URL}/bank-sync/connections`, { headers: asUser(user) })
  const [connection] = (await listed.json()) as SeededConnection[]
  const checking = connection.accounts.find((bankAccount) => bankAccount.name === SAMPLE_CHECKING)!
  await linkBankAccount(request, user, {
    accountId: everyday.id,
    connectionId: connection.id,
    externalAccountId: checking.external_id,
    startDate: daysFromTodayInTestTimezone(-10),
  })
  await waitForReviewItems(request, user, everyday.id, (items) => items.length === SAMPLE_DESCRIPTIONS.length)

  // The bank's consent ends, so the next sync is refused and the connection needs the bank again
  await expireEnableBankingSessions(request, scenario.id)
  await syncBankLinkNow(request, user, everyday.id)
  await waitForConnection(request, user, connection.id, (current) => current.status === 'credential_rejected')

  await openPage(page, '/settings#bank-connections')
  await section.locator(`[data-connection-id="${connection.id}"] button`).click()
  await page.getByRole('dialog', { name: 'Enable Banking', exact: true }).getByRole('button', { name: 'Reconnect', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Reconnect Enable Banking' })
  await expect(form.getByRole('combobox', { name: 'Provider' })).toHaveCount(0)
  await form.getByRole('textbox', { name: 'Application ID' }).fill(scenario.applicationId)
  await dropFile(form.getByLabel('Private key', { exact: true }), `${scenario.applicationId}.pem`, scenario.privateKey)
  await form.getByRole('textbox', { name: 'Country' }).fill(scenario.country)
  await form.getByRole('textbox', { name: 'Bank' }).fill(scenario.bank)
  await form.getByRole('button', { name: 'Go to your bank' }).click()
  await page.getByRole('link', { name: 'Share my accounts' }).click()

  // The same connection works again, and its linked account picks up where it stopped
  await expect(page.getByRole('status').filter({ hasText: 'Syncing resumes for 1 account.' })).toBeVisible()
  await expect(page).toHaveURL(/\/settings#bank-connections$/)
  await waitForConnection(request, user, connection.id, (current) => current.status === 'active')
  const after = await request.get(`${API_BASE_URL}/bank-sync/connections`, { headers: asUser(user) })
  expect(((await after.json()) as SeededConnection[]).map((current) => current.id)).toEqual([connection.id])
})

test('adds nothing when the bank does not approve access', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  test.skip(!(await isEnableBankingOffered(request, user)), 'Enable Banking is not installed on this server')
  const scenario = await createSampleEnableBankingScenario(request)

  await logInViaApi(page, user)
  await openPage(page, '/settings#bank-connections')
  await page.locator('#bank-connections').getByRole('button', { name: 'Add a connection' }).click()
  await fillConnectForm(page.getByRole('dialog', { name: 'Add a connection' }), scenario)

  // Back in Settings where it started, with the message, and not on a page of its own
  await page.getByRole('link', { name: 'Decline' }).click()
  await expect(errorToast(page, DECLINED_MESSAGE)).toBeVisible()
  await expect(page).toHaveURL(/\/settings#bank-connections$/)
  await expect(page.getByRole('heading', { name: 'Bank sign-in not finished' })).toHaveCount(0)

  const listed = await request.get(`${API_BASE_URL}/bank-sync/connections`, { headers: asUser(user) })
  expect(await listed.json()).toEqual([])
})

test('returns to the account link step when the bank does not approve access, and Back does not send the answer again', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  test.skip(!(await isEnableBankingOffered(request, user)), 'Enable Banking is not installed on this server')
  const everyday = await createAccount(request, user, { name: 'Everyday', currency: 'EUR' })
  const scenario = await createSampleEnableBankingScenario(request)
  const finishes: string[] = []
  page.on('request', (sent) => {
    if (sent.method() === 'POST' && sent.url().endsWith('/bank-sync/authorizations/finish')) finishes.push(sent.url())
  })

  await logInViaApi(page, user)
  const accountDialog = await openBankLink(page, everyday.id, 'No bank link')
  await accountDialog.getByRole('button', { name: 'Link bank account' }).click()
  await page.getByRole('dialog', { name: 'Link bank account' }).getByRole('button', { name: 'Open settings' }).click()
  await fillConnectForm(page.getByRole('dialog', { name: 'Add a connection' }), scenario)

  await page.getByRole('link', { name: 'Decline' }).click()

  // The account's link step is open again with the message, at the account's address
  const flow = page.getByRole('dialog', { name: 'Link bank account' })
  await expect(flow.getByText('Please add a bank connection in Settings first.')).toBeVisible()
  await expect(errorToast(page, DECLINED_MESSAGE)).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/accounts/${everyday.id}$`))
  expect(finishes).toHaveLength(1)

  // The return page replaced its own history entry, so Back leaves for the bank's page and never lands on it
  await page.goBack()
  await expect(page).not.toHaveURL(/\/settings\/bank-authorization/)
  expect(finishes).toHaveLength(1)
})
