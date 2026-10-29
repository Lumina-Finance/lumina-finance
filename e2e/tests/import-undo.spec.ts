import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { asUser, createAccount, signUpUser } from '../support/api'
import { commitImport, logInViaApi, openPage, showImportSetup } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: what undoing an import removes is the same at every size

test('undoes the last import, deleting everything it added and keeping the account it went into', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 10000 })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)

  const csv = [
    'Date,Amount,Category,Merchant,Notes',
    '2024-03-15,-12.50,Groceries,Unknown,Undo test out',
    '2024-03-16,40.00,Salary,Unknown,Undo test in',
  ].join('\n')
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'undo-test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })

  expect((await commitImport(page)).status()).toBe(201)

  // Opened afresh, as a user coming back to undo a test import would
  await openPage(page, `/settings/imports?account=${account.id}`)
  const lastImport = page.getByRole('region', { name: 'Last import' })
  await expect(lastImport).toContainText(/CSV\s·\s.+\s·\s2\stransactions/)
  await expect(lastImport).toContainText('Can be undone until')
  await page.getByRole('button', { name: 'Undo import of undo-test.csv' }).click()

  const dialog = page.getByRole('dialog', { name: 'Undo this import?' })
  await expect(dialog).toContainText('This deletes everything undo-test.csv added: 2 transactions')
  const undone = page.waitForResponse((response) => response.request().method() === 'POST'
    && /\/transactions\/import\/runs\/[^/]+\/undo$/.test(response.url()))
  await dialog.getByRole('button', { name: 'Undo import', exact: true }).click()
  expect((await undone).status()).toBe(200)
  await expect(dialog).toBeHidden()
  await expect(lastImport).toBeHidden()

  // Nothing is staged on a page opened afresh, so the importer starts empty and the pop-up says to upload again
  await expect(page.getByRole('status').filter({ hasText: 'Import undone. Upload the files again to import them.' })).toBeVisible()
  await expect(page.getByText('No files staged', { exact: true })).toBeVisible()

  // The account existed before the import, so it stays with only its starting balance
  const transactions = await request.get(`${API_BASE_URL}/transactions`, {
    headers: asUser(user),
    params: { account_id: account.id },
  })
  expect((await transactions.json() as unknown[]).length).toBe(1)
  const kept = await request.get(`${API_BASE_URL}/accounts/${account.id}`, { headers: asUser(user) })
  expect(kept.status()).toBe(200)
  expect((await kept.json() as { current_balance: number }).current_balance).toBe(10000)
})

test('ends the last import card where the data source dropdown ends at 1280px', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 10000 })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)

  const csv = ['Date,Amount,Category,Merchant,Notes', '2024-03-15,-12.50,Groceries,Unknown,Align test'].join('\n')
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'align-test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  expect((await commitImport(page)).status()).toBe(201)

  await openPage(page, `/settings/imports?account=${account.id}`)
  await expect(page.getByRole('region', { name: 'Last import' })).toContainText('Can be undone until')

  const edges = await page.evaluate(() => {
    const rightOf = (element: Element | null) => element!.getBoundingClientRect().right
    return {
      card: rightOf(document.querySelector('section[aria-label="Last import"]')),
      dropdown: rightOf(document.querySelector('.app-dropdown-glass')),
    }
  })
  expect(edges.card).toBeCloseTo(edges.dropdown, 0)
})

// The row dated February 31 is skipped, which keeps the finished import on screen to be read
const ON_SCREEN_CSV = [
  'Date,Amount,Merchant',
  '2024-03-15,-12.50,Market',
  '2024-02-31,-9.99,Market',
  '2024-03-16,-4.00,Market',
].join('\n')

test('gives the importer back with its files and answers when the import it ran is undone', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 10000 })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'undo-back.csv', mimeType: 'text/csv', buffer: Buffer.from(ON_SCREEN_CSV) })

  // An answer given by hand, which has to come back as it was
  const merchantField = page.getByRole('combobox', { name: 'Match to app field Merchant', exact: true })
  await merchantField.click()
  await page.getByRole('option', { name: 'Do not import', exact: true }).click()
  await expect(merchantField).toContainText('Do not import')
  await commitImport(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Review skipped rows', exact: true }).click()
  await expect(merchantField).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Remove undo-back.csv', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Imported', exact: true })).toBeDisabled()

  await page.getByRole('button', { name: 'Undo import of undo-back.csv' }).click()
  await page.getByRole('dialog', { name: 'Undo this import?' }).getByRole('button', { name: 'Undo import', exact: true }).click()

  // Announced as a status, and the page is as it was before Commit import
  const popUp = page.getByRole('status').filter({
    hasText: 'Import undone. Your files and answers are back, so you can change anything and import again.',
  })
  await expect(popUp).toBeVisible()

  // The undo button went with the import, so focus is kept on the page for a keyboard user
  await expect(page.getByRole('dialog', { name: 'Undo this import?' })).toBeHidden()
  await expect(page.locator(':focus')).toHaveAttribute('tabindex', '-1')
  await expect(merchantField).toBeEnabled()
  await expect(merchantField).toContainText('Do not import')
  await showImportSetup(page)
  await expect(page.getByRole('button', { name: 'Remove undo-back.csv', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Last import' })).toBeHidden()

  // And it imports again, from the answers on screen
  expect((await commitImport(page)).status()).toBe(201)
})

/**
 * Opens the imports page in a second tab of the same browser and undoes the import the first tab
 * ran, as a user with two Imports tabs open would. The first tab is told nothing: it learns of the
 * undo the way it learns of any change made elsewhere, when it is looked at again
 */
async function undoInSecondTab(page: Page, accountId: string, fileName: string) {
  const otherTab = await page.context().newPage()
  await openPage(otherTab, `/settings/imports?account=${accountId}`)
  const lastImport = otherTab.getByRole('region', { name: 'Last import' })
  await expect(lastImport).toContainText(`${fileName}`)
  await otherTab.getByRole('button', { name: `Undo import of ${fileName}` }).click()
  await otherTab.getByRole('dialog', { name: 'Undo this import?' }).getByRole('button', { name: 'Undo import', exact: true }).click()
  await expect(lastImport).toBeHidden()
  await otherTab.close()
}

/**
 * Makes the page run the app's cache check, as returning to its window does, and waits for it to
 * read the last import again and for whatever it then asks to settle, so a test that expects
 * nothing to change has given the page the chance to
 */
async function returnToTab(page: Page) {
  const answered = page.waitForResponse((response) => response.url() === `${API_BASE_URL}/transactions/import/last`)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await answered
  await page.waitForLoadState('networkidle')
}

/**
 * Holds back the page's reads of the last import, as an away tab's wait, so it learns of nothing
 * until the returned function lets them through
 */
async function holdLastImportReads(page: Page) {
  let release!: () => void
  const isReleased = new Promise<void>((resolve) => { release = resolve })
  await page.route(`${API_BASE_URL}/transactions/import/last`, async (route) => {
    await isReleased
    await route.continue()
  })
  return release
}

/** Imports the file in the page's tab and leaves it showing as finished */
async function importAndKeepFinished(page: Page, fileName: string, accountId: string) {
  await openPage(page, `/settings/imports?account=${accountId}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: fileName, mimeType: 'text/csv', buffer: Buffer.from(ON_SCREEN_CSV) })
  await commitImport(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Review skipped rows', exact: true }).click()
}

test('opens a finished import again when another tab undoes it', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 10000 })
  await logInViaApi(page, user)
  await importAndKeepFinished(page, 'undo-elsewhere.csv', account.id)
  const merchantField = page.getByRole('combobox', { name: 'Match to app field Merchant', exact: true })
  await expect(merchantField).toBeDisabled()

  await undoInSecondTab(page, account.id, 'undo-elsewhere.csv')
  await returnToTab(page)

  // As the tab that undid it would have left it: the files and answers back, and the user told
  const popUp = page.getByRole('status').filter({
    hasText: 'Import undone. Your files and answers are back, so you can change anything and import again.',
  })
  await expect(popUp).toBeVisible()
  await expect(merchantField).toBeEnabled()
  await expect(page.getByRole('region', { name: 'Last import' })).toBeHidden()
})

test('leaves a tab filling in a next import alone when another tab undoes the last one', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 10000 })
  await logInViaApi(page, user)
  await importAndKeepFinished(page, 'undo-elsewhere.csv', account.id)

  // A file chosen after the import starts the next one
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /^Upload CSV file/ }).click()
  await (await chooser).setFiles({
    name: 'next.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Date,Amount,Merchant\n2024-04-02,-12.00,Bakery'),
  })
  // In the steps, since the file's own preview sits in the setup panel, which has collapsed away
  const nextRow = page.getByRole('region', { name: 'Import steps' }).getByText(/12\.00/).first()
  await expect(nextRow).toBeVisible()

  await undoInSecondTab(page, account.id, 'undo-elsewhere.csv')
  await returnToTab(page)

  // Its Last import card going is the sign the check has run
  await expect(page.getByRole('region', { name: 'Last import' })).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: 'Import undone' })).toHaveCount(0)
  await expect(nextRow).toBeVisible()
})

test('keeps a finished import when a later import is saved and undone in another tab meanwhile', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 10000 })
  await logInViaApi(page, user)
  await importAndKeepFinished(page, 'first-import.csv', account.id)
  const merchantField = page.getByRole('combobox', { name: 'Match to app field Merchant', exact: true })

  // Saving the later import takes the first one's place as the last import, and undoing it leaves
  // no last import, all before this tab looks again. The first import's rows are still saved
  const returned = await holdLastImportReads(page)
  const otherTab = await page.context().newPage()
  await importAndKeepFinished(otherTab, 'later-import.csv', account.id)
  await otherTab.getByRole('button', { name: 'Undo import of later-import.csv' }).click()
  await otherTab.getByRole('dialog', { name: 'Undo this import?' }).getByRole('button', { name: 'Undo import', exact: true }).click()
  await expect(otherTab.getByRole('region', { name: 'Last import' })).toBeHidden()
  // Recorded as the server sends it, before the page reads it. The app signs a request again once a
  // refused one has had its sign-in refreshed, so only the answers are kept
  const answers: Array<{ is_saved?: boolean }> = []
  await page.route(`${API_BASE_URL}/transactions/import/runs/*`, async (route) => {
    const response = await route.fetch()
    if (response.ok()) answers.push(await response.json() as { is_saved: boolean })
    await route.fulfill({ response })
  })
  const asked = page.waitForResponse((response) => response.url().includes('/transactions/import/runs/') && response.ok())
  returned()
  await returnToTab(page)
  await asked

  // Told the first import is still saved, so a skipped question would not pass this
  expect(answers.length).toBeGreaterThan(0)
  expect(answers).not.toContainEqual({ is_saved: false })
  await expect(page.getByRole('region', { name: 'Last import' })).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: 'Import undone' })).toHaveCount(0)
  await expect(merchantField).toBeDisabled()
})

test('opens a finished import again when it is undone and a later import is saved in other tabs', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 10000 })
  await logInViaApi(page, user)
  await importAndKeepFinished(page, 'undo-then-later.csv', account.id)
  const merchantField = page.getByRole('combobox', { name: 'Match to app field Merchant', exact: true })
  await expect(merchantField).toBeDisabled()

  const returned = await holdLastImportReads(page)

  await undoInSecondTab(page, account.id, 'undo-then-later.csv')
  await importAndKeepFinished(await page.context().newPage(), 'later-import.csv', account.id)
  returned()
  await returnToTab(page)

  // The last import is the later one, which is no sign the first was not undone
  await expect(page.getByRole('status').filter({
    hasText: 'Import undone. Your files and answers are back, so you can change anything and import again.',
  })).toBeVisible()
  await expect(merchantField).toBeEnabled()
})

test('keeps a finished import when its undo ended without being used', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 10000 })
  await logInViaApi(page, user)
  await importAndKeepFinished(page, 'made-permanent.csv', account.id)
  const merchantField = page.getByRole('combobox', { name: 'Match to app field Merchant', exact: true })

  // Any other change to the user's data makes the import permanent, which takes its Last import card
  // away without undoing anything
  await createAccount(request, user, { name: 'Savings' })
  await returnToTab(page)
  await expect(page.getByRole('region', { name: 'Last import' })).toBeHidden()

  await expect(page.getByRole('status').filter({ hasText: 'Import undone' })).toHaveCount(0)
  await expect(merchantField).toBeDisabled()
})

/**
 * Stages a file in the page, which folds the setup panel and the card with it, then saves an import in
 * another tab and comes back, which is what the page sees as the last import arriving from elsewhere
 */
async function receiveImportFromAnotherTab(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 10000 })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'staged-here.csv', mimeType: 'text/csv', buffer: Buffer.from(ON_SCREEN_CSV) })

  // The staged file folds the setup panel away, and the card with it
  const setupToggle = page.getByRole('button', { name: /(Collapse|Expand) import setup/ })
  await expect(setupToggle).toHaveAccessibleName('Expand import setup')

  const otherTab = await page.context().newPage()
  await importAndKeepFinished(otherTab, 'saved-elsewhere.csv', account.id)
  await returnToTab(page)

  const lastImport = page.getByRole('region', { name: 'Last import' })
  await expect(setupToggle).toHaveAccessibleName('Collapse import setup')
  await expect(lastImport).toBeVisible()
  await expect(lastImport).toContainText('saved-elsewhere.csv')
  return lastImport
}

test('opens the setup panel and flashes the last import when another tab saves one', async ({ page, request }) => {
  const lastImport = await receiveImportFromAnotherTab(page, request)

  // The flash starts once the panel is open and a pause has passed with the tab in view, and plays three times
  await expect(lastImport).toHaveClass(/import-last-import-flash/)
  await expect(lastImport).toHaveCSS('animation-iteration-count', '3')
  await expect(page.getByRole('status').filter({ hasText: 'Your last import changed to saved-elsewhere.csv.' })).toBeAttached()
})

test('opens the setup panel without flashing the last import under reduced motion', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const lastImport = await receiveImportFromAnotherTab(page, request)

  // The pause has passed once the class is on, and no animation plays under it
  await expect(lastImport).toHaveClass(/import-last-import-flash/)
  await expect(lastImport).toHaveCSS('animation-name', 'none')
  await expect(page.getByRole('status').filter({ hasText: 'Your last import changed to saved-elsewhere.csv.' })).toBeAttached()
})
