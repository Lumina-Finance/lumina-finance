import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  asUser,
  createAccount,
  createGroup,
  createTransaction,
  daysFromTodayInTestTimezone,
  formatToday,
  signUpUser,
  startOfDayInTestTimezone,
  todayInTestTimezone,
} from '../support/api'
import { chooseFromDropdown, logInViaApi, openModal, openPage, typeDate } from '../support/app'
import { addImportedItem, answerLinksWith, linkToSampleBankAccount } from '../support/bankSync'
import { contrastOf, MIN_TEXT_CONTRAST } from '../support/selectors'
import { AT_EVERY_SIZE } from '../support/sizes'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only. The refused day, refused move and greyed Delete tests run at
// every size: the transaction modal's fields, messages and reasons sit differently at each width

// A linked account's bank supplies its transactions from the import start through today, so the
// transaction modal refuses those days, a bank transaction can't leave the account or be deleted, and
// the account can't be archived until it is unlinked.
//
// Each test links its account on the server through the fake SimpleFIN Bridge, so the server refuses
// what the browser should, and the requests sent show which refusals were the browser's own. Those
// checking that archiving waits only on a link that can be read link nothing
const SAMPLE_CHEQUING = 'Everyday Chequing'

// A sample item dated 9 days before the Bridge's today. An import from 10 days back brings it in
// even when the Bridge's UTC day has moved on from the test timezone's
const SAMPLE_COFFEE = 'EFTPOS BEAN THERE CAFE'
const IMPORT_START_DAYS_AGO = 10

const MESSAGE_FROM_TODAY = `SimpleFIN supplies this account's transactions from ${formatToday()} to today`
const MOVE_REFUSAL = "Transactions from SimpleFIN can't move out of Everyday while it's linked"
const ARCHIVE_LINKED_REASON = "This account can't be archived while it's linked to SimpleFIN. Unlink it first."
const DELETE_LINKED_REASON = 'Imported from SimpleFIN. While Everyday is linked, edit it rather than deleting it.'
const BULK_DELETE_LINKED_REASON = "Transactions from SimpleFIN can't be deleted from Everyday while it's linked"

// Where the pointer first rests on Delete, measured in from the button's top-left corner, and how far
// it then moves down to see the reason follow, staying inside the button's 40px height. A move
// sideways can leave the reason pinned to the screen's edge, since it sits left of the cursor
const POINTER_INSET_PX = 10
const POINTER_STEP_PX = 20

// The layout puts Date, Currency and Amount side by side from this width
const FIELD_ROW_MIN_WIDTH = 640

/**
 * Opens Add Transaction from an account's page with that account chosen. Picked rather than assumed,
 * since the modal takes its default from the accounts it has loaded by the time it opens
 */
async function openAddTransaction(page: Page, accountName: string): Promise<Locator> {
  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
  await chooseFromDropdown(dialog, 'Account', accountName)
  return dialog
}

type Box = { x: number; y: number; width: number; height: number }

async function getBox(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('the element has no box on screen')
  return box
}

/**
 * Reads how opaque the cursor tooltip showing this text is. The tooltip fades its outer box, the one
 * hidden from assistive technology, while the text inside keeps an opacity of 1 throughout
 */
async function readTooltipOpacity(text: Locator): Promise<string> {
  return text.evaluate((node) => {
    const tooltip = node.closest('[aria-hidden="true"]')
    if (!tooltip) throw new Error('the text is not inside a cursor tooltip')
    return getComputedStyle(tooltip).opacity
  })
}

/** Opens the account's Edit modal from its page */
async function openEditAccount(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

/**
 * Types a date into the modal's date field and leaves the field, as a user does. Clicking Notes leaves
 * it, and leaving the field is what lets the form show a refusal of the date
 */
async function enterDate(page: Page, dialog: Locator, date: string): Promise<void> {
  await typeDate(page, 'Date', date)
  await dialog.getByLabel('Notes').click()
}

// A stand-in can still be fetching for the page when a test ends. That would otherwise surface as an
// error outside any test
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('refuses a new manual entry on the days a linked account’s bank supplies', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await linkToSampleBankAccount(request, user, { accountId: account.id, bankAccountName: SAMPLE_CHEQUING })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)

  const dialog = await openAddTransaction(page, 'Everyday')
  const date = dialog.getByRole('group', { name: 'Date' })
  const currency = dialog.getByRole('combobox', { name: 'Currency' })
  const amount = dialog.getByRole('textbox', { name: 'Amount', exact: true })
  const message = dialog.getByRole('alert').filter({ hasText: MESSAGE_FROM_TODAY })

  // Every create sent, so one the browser refused would show up ahead of the one it let through
  const sentDates: unknown[] = []
  page.on('request', (sent) => {
    if (sent.url() === `${API_BASE_URL}/transactions` && sent.method() === 'POST') sentDates.push(sent.postDataJSON().dt)
  })

  // The date starts on today, the last day the bank supplies, and says nothing until a save is tried
  await expect(message).toBeHidden()
  await chooseFromDropdown(dialog, 'Category', 'Groceries')
  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  await amount.fill('12.34')
  await dialog.getByTestId('transaction-submit').click()
  await expect(message).toBeVisible()
  const year = date.getByRole('textbox', { name: 'Year' })
  await expect(year).toHaveAttribute('aria-invalid', 'true')
  await expect(year).toHaveAccessibleDescription(MESSAGE_FROM_TODAY)

  // Under the whole row once the fields sit side by side, keeping Date, Currency and Amount level, and
  // between the date and the currency on a phone. Read once the message has finished opening, within
  // a pixel since its box starts where the row ends
  const isPlaced = async () => {
    const [dateBox, currencyBox, amountBox, messageBox] = await Promise.all([date, currency, amount, message].map(getBox))
    const isBelow = (box: Box, above: Box) => box.y >= above.y + above.height - 1
    return page.viewportSize()!.width >= FIELD_ROW_MIN_WIDTH
      ? isBelow(messageBox, amountBox)
      : isBelow(messageBox, dateBox) && isBelow(currencyBox, messageBox)
  }
  await expect.poll(isPlaced).toBe(true)

  // The calendar refuses today, and a later day the bank can't have supplied yet is taken
  await dialog.getByRole('button', { name: 'Open calendar' }).click()
  const todayCell = page.getByRole('button').and(page.locator(`[data-iso="${todayInTestTimezone()}"]`))
  const tomorrowCell = page.getByRole('button').and(page.locator(`[data-iso="${daysFromTodayInTestTimezone(1)}"]`))
  await expect(todayCell).toHaveAttribute('aria-disabled', 'true')
  await expect(tomorrowCell).not.toHaveAttribute('aria-disabled', 'true')

  // Today is the chosen day as well as a refused one, and its number stays readable, pointed at or not
  await expect(todayCell).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => contrastOf(todayCell)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
  await todayCell.hover()
  await expect.poll(() => contrastOf(todayCell)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
  await tomorrowCell.click()
  await expect(message).toBeHidden()
  await expect(year).toHaveAttribute('aria-invalid', 'false')

  const created = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/transactions` && response.request().method() === 'POST')
  await dialog.getByTestId('transaction-submit').click()
  expect((await created).status()).toBe(201)
  await expect(dialog).toBeHidden()
  expect(sentDates).toEqual([daysFromTodayInTestTimezone(1)])
})

test('refuses the days the other account’s bank supplies once a new transfer is recorded in both, naming it', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const visa = await createAccount(request, user, { name: 'Visa' })
  await linkToSampleBankAccount(request, user, { accountId: visa.id, bankAccountName: 'Rewards Visa' })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)

  const dialog = await openAddTransaction(page, 'Everyday')
  await dialog.getByRole('tab', { name: 'Transfer', exact: true }).click()
  await chooseFromDropdown(dialog, 'Category', 'Transfer')
  await chooseFromDropdown(dialog, 'Money went to', 'Visa')
  await enterDate(page, dialog, todayInTestTimezone())

  // Recorded in both, the transfer writes a transaction into Visa too, so Visa's days count
  const recordInBoth = dialog.getByRole('checkbox', { name: /Record in both accounts/ })
  const message = dialog.getByRole('alert').filter({
    hasText: `SimpleFIN supplies the transactions in Visa from ${formatToday()} to today`,
  })
  await recordInBoth.check()
  await expect(message).toBeVisible()

  // Recorded in Everyday alone, it only notes where the money went
  await recordInBoth.uncheck()
  await expect(message).toBeHidden()
})

test.describe('with the browser in Tokyo and the profile in Toronto', () => {
  test.use({ timezoneId: 'Asia/Tokyo' })

  test('ends the days the bank supplies on today in the profile’s timezone', async ({ page, request }) => {
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday' })
    const today = todayInTestTimezone()
    const tomorrow = daysFromTodayInTestTimezone(1)
    await linkToSampleBankAccount(request, user, { accountId: account.id, bankAccountName: SAMPLE_CHEQUING })
    await logInViaApi(page, user)

    // An hour before tomorrow begins in Toronto, when it is already tomorrow afternoon in Tokyo
    await page.clock.install({ time: startOfDayInTestTimezone(tomorrow).getTime() - 3_600_000 })
    await openPage(page, `/accounts/${account.id}`)

    // The bank has supplied Toronto's today, and Tokyo's today is still to come in the profile
    const dialog = await openAddTransaction(page, 'Everyday')
    await dialog.getByRole('button', { name: 'Open calendar' }).click()
    const dayCell = (iso: string) => page.getByRole('button').and(page.locator(`[data-iso="${iso}"]`))
    await expect(dayCell(today)).toHaveAttribute('aria-disabled', 'true')
    await expect(dayCell(tomorrow)).not.toHaveAttribute('aria-disabled', 'true')
  })
})

// A manual entry on a day the bank supplies can't be seeded on the server, since an import starts after
// the account's latest transaction and every write onto those days is refused, so this test answers the
// list of links with one importing from Jan 1, 2026 instead. The server then accepts every save, so a
// refusal seen here is the browser's own
test('lets an edit keep a date the linked account’s bank supplies, and refuses moving it to another such day', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4250,
    date: '2026-01-15',
  })
  await answerLinksWith(page, () => [account.id])
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const row = page.getByTestId(`transaction-row-${id}`)
  const dialog = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
  const message = dialog.getByRole('alert').filter({ hasText: "SimpleFIN supplies this account's transactions from Jan 1, 2026 to today" })

  // Changing only the notes dates nothing anew, so it saves where the transaction already sits
  await row.click()
  await dialog.getByLabel('Notes').fill('Receipt checked')
  const notesSaved = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/transactions/${id}` && response.request().method() === 'PATCH')
  await dialog.getByTestId('transaction-submit').click()
  expect((await notesSaved).status()).toBe(200)
  await expect(dialog).toBeHidden()

  // Every save sent from here on, so one the browser refused would show up ahead of the one it let through
  const sentDates: unknown[] = []
  page.on('request', (sent) => {
    if (sent.url() === `${API_BASE_URL}/transactions/${id}` && sent.method() === 'PATCH') sentDates.push(sent.postDataJSON().dt)
  })

  await row.click()
  await enterDate(page, dialog, '2026-01-16')
  await expect(message).toBeVisible()
  await dialog.getByTestId('transaction-submit').click()
  await expect(dialog).toBeVisible()

  // The day before the import start is the user's own to fill
  await enterDate(page, dialog, '2025-12-31')
  await expect(message).toBeHidden()
  const dateSaved = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/transactions/${id}` && response.request().method() === 'PATCH')
  await dialog.getByTestId('transaction-submit').click()
  expect((await dateSaved).status()).toBe(200)
  await expect(dialog).toBeHidden()
  expect(sentDates).toEqual(['2025-12-31'])
})

test('keeps a bank transaction in its linked account, refusing the move on the account field', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createAccount(request, user, { name: 'Savings' })
  await linkToSampleBankAccount(request, user, {
    accountId: account.id,
    bankAccountName: SAMPLE_CHEQUING,
    startDate: daysFromTodayInTestTimezone(-IMPORT_START_DAYS_AGO),
  })
  const { id } = await addImportedItem(request, user, account.id, SAMPLE_COFFEE)
  const correctedDate = daysFromTodayInTestTimezone(-3)
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const dialog = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
  const refusal = dialog.getByRole('alert').filter({ hasText: MOVE_REFUSAL })

  const sentDates: unknown[] = []
  page.on('request', (sent) => {
    if (sent.url() === `${API_BASE_URL}/transactions/${id}` && sent.method() === 'PATCH') sentDates.push(sent.postDataJSON().dt)
  })

  // The bank's own date is the bank's to correct, so another day it supplies is taken
  await page.getByTestId(`transaction-row-${id}`).click()
  await enterDate(page, dialog, correctedDate)

  // Leaving the account is refused on its field, and a save sends nothing
  await chooseFromDropdown(dialog, 'Account', 'Savings')
  await expect(refusal).toBeVisible()
  await expect(dialog.getByRole('combobox', { name: 'Account' })).toHaveAttribute('aria-invalid', 'true')

  // Beside the label with the row's gap between them, at every width, once it has slid into place
  const label = dialog.locator('label[for="txn-account"]')
  await expect.poll(async () => {
    const [labelBox, refusalBox] = await Promise.all([getBox(label), getBox(refusal)])
    return Math.round(refusalBox.x - (labelBox.x + labelBox.width))
  }).toBeGreaterThanOrEqual(12)
  await dialog.getByTestId('transaction-submit').click()
  await expect(dialog).toBeVisible()

  await chooseFromDropdown(dialog, 'Account', 'Everyday')
  await expect(refusal).toBeHidden()
  const saved = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/transactions/${id}` && response.request().method() === 'PATCH')
  await dialog.getByTestId('transaction-submit').click()
  expect((await saved).status()).toBe(200)
  await expect(dialog).toBeHidden()
  expect(sentDates).toEqual([correctedDate])
})

test('greys out Archive with its reason while the account is linked, and offers it again once unlinked', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const laterId = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4250,
    date: daysFromTodayInTestTimezone(3),
  })
  await linkToSampleBankAccount(request, user, { accountId: account.id, bankAccountName: SAMPLE_CHEQUING })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)

  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  const archive = dialog.getByRole('switch', { name: /^Archive account/ })
  const warning = dialog.getByText('Balance will be set to zero')
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  await expect(archive).toBeDisabled()
  await expect(archive).toHaveAccessibleDescription(ARCHIVE_LINKED_REASON)

  // A later-dated transaction would block archiving too, but the switch gives one reason at a time
  await expect(dialog.getByText(/future dated transactions/)).toHaveCount(0)

  // The reason shows under the row, in the layout rather than over it, so it covers nothing
  const archiveReason = dialog.getByText(ARCHIVE_LINKED_REASON, { exact: true })
  await expect(archiveReason).toBeVisible()

  // A press can't change the switch, so pointing at its row leaves the track as it rests. The hover rule
  // sets the fill properties at once, so reading them needs no wait for the colour to transition
  const row = dialog.getByText('Archive account', { exact: true })
  const trackFill = () =>
    archive.evaluate((input) => {
      const style = getComputedStyle(input.nextElementSibling as Element)
      return [style.getPropertyValue('--app-switch-off'), style.getPropertyValue('--app-switch-on'), style.backgroundColor]
    })
  const restingFill = await trackFill()
  await row.hover()
  expect(await trackFill()).toEqual(restingFill)

  // Forced, because the switch is marked unavailable and pressing it anyway is what is checked
  await row.click({ force: true })
  await expect(archive).not.toBeChecked()
  await expect(warning).toBeHidden()

  // Deleting offers archiving instead, and that is unavailable for the same reason
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click()
  const archiveInstead = dialog.getByRole('button', { name: 'Archive instead', exact: true })
  await expect(archiveInstead).toHaveAttribute('aria-disabled', 'true')
  await expect(archiveInstead).toHaveAccessibleDescription(ARCHIVE_LINKED_REASON)

  // Without the later-dated transaction, unlinking is all archiving waits on
  const deleted = await request.delete(`${API_BASE_URL}/transactions/${laterId}`, { headers: asUser(user) })
  expect(deleted.ok()).toBe(true)

  // The app keeps what it last read across a reload, so this load starts without that copy and reads
  // the link afresh, as it does once unlinking refreshes it
  const unlinked = await request.delete(`${API_BASE_URL}/accounts/${account.id}/bank-link`, { headers: asUser(user) })
  expect(unlinked.ok()).toBe(true)
  await page.addInitScript(() => localStorage.removeItem('lumina:query-cache'))
  await openPage(page, `/accounts/${account.id}`)

  // The switch is held back until the link is read, so the read has to arrive first
  await expect(page.getByRole('button', { name: /^Bank sync: Not linked/ })).toBeVisible()
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  await expect(archive).toBeEnabled()
  await expect(archiveReason).toBeHidden()
  await dialog.getByText('Archive account', { exact: true }).click()
  await expect(archive).toBeChecked()
  await expect(warning).toBeVisible()

  // Archive instead is offered again too
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click()
  await expect(archiveInstead).not.toHaveAttribute('aria-disabled')
})

test('holds Archive back until the link has been read, so a linked account is never offered it', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await linkToSampleBankAccount(request, user, { accountId: account.id, bankAccountName: SAMPLE_CHEQUING })

  // The page and its edit modal share one read of the link, held until both controls have been checked
  let releaseRead = () => {}
  const readReleased = new Promise<void>((resolve) => { releaseRead = resolve })
  await page.route(`${API_BASE_URL}/accounts/${account.id}/bank-link`, async (route) => {
    await readReleased
    await route.fallback()
  })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  const archive = dialog.getByRole('switch', { name: /^Archive account/ })
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click()
  const archiveInstead = dialog.getByRole('button', { name: 'Archive instead', exact: true })
  await expect(archive).toBeDisabled()
  await expect(archiveInstead).toBeDisabled()

  releaseRead()
  await expect(archive).toHaveAccessibleDescription(ARCHIVE_LINKED_REASON)
  await expect(archiveInstead).toHaveAccessibleDescription(ARCHIVE_LINKED_REASON)
})

// Held back through aria-disabled, Archive instead still takes focus and does nothing on Enter, so the
// panel's first step starts on Continue, as it does where Archive instead is absent
test('focuses Continue, not the held Archive instead, when the delete panel opens on a linked account', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await linkToSampleBankAccount(request, user, { accountId: account.id, bankAccountName: SAMPLE_CHEQUING })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const dialog = await openEditAccount(page)

  // Pressed once the link has been read, since a link still loading disables Archive instead outright
  await expect(dialog.getByRole('switch', { name: /^Archive account/ })).toBeDisabled()
  const trash = dialog.getByRole('button', { name: 'Delete account', exact: true })
  await trash.focus()
  await trash.press('Enter')

  const archiveInstead = dialog.getByRole('button', { name: 'Archive instead', exact: true })
  await expect(archiveInstead).toHaveAttribute('aria-disabled', 'true')
  await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeFocused()
})

// The link is read only for the user's own personal accounts, so archiving one in a group never waits on it
test('offers Archive on a group account, whose link is never read', async ({ page, request }) => {
  const user = await signUpUser(request)
  const groupId = await createGroup(request, user, 'Household')
  const account = await createAccount(request, user, { name: 'Shared', groupId })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const dialog = await openEditAccount(page)
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click()

  await expect(dialog.getByRole('switch', { name: /^Archive account/ })).toBeEnabled()
  await expect(dialog.getByRole('button', { name: 'Archive instead', exact: true })).toBeEnabled()
})

// The server refuses to archive a linked account with its reason, so a link that can't be read leaves it to
test('offers Archive once the link fails to load', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await page.route(`${API_BASE_URL}/accounts/${account.id}/bank-link`, (route) =>
    route.fulfill({ status: 500, json: { detail: 'Internal Server Error' } }))
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await expect(page.getByRole('button', { name: "Bank sync: Couldn't check. Open bank link" })).toBeVisible()
  const dialog = await openEditAccount(page)
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click()

  await expect(dialog.getByRole('switch', { name: /^Archive account/ })).toBeEnabled()
  await expect(dialog.getByRole('button', { name: 'Archive instead', exact: true })).toBeEnabled()
})

// An archived account can't be linked, so bringing it back never waits on its link
test('offers to bring an archived account back while its link is still being read', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const archived = await request.patch(`${API_BASE_URL}/accounts/${account.id}`, { headers: asUser(user), data: { is_archived: true } })
  expect(archived.ok()).toBe(true)

  // Never answered, so the link is still being read whenever the switch is checked
  await page.route(`${API_BASE_URL}/accounts/${account.id}/bank-link`, () => {})
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const dialog = await openEditAccount(page)

  await expect(dialog.getByRole('switch', { name: /^Archive account/ })).toBeChecked()
  await expect(dialog.getByRole('switch', { name: /^Archive account/ })).toBeEnabled()
})

test('greys out Delete on a bank transaction with its reason while the account is linked, and deletes it once unlinked', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await linkToSampleBankAccount(request, user, {
    accountId: account.id,
    bankAccountName: SAMPLE_CHEQUING,
    startDate: daysFromTodayInTestTimezone(-IMPORT_START_DAYS_AGO),
  })
  const { id } = await addImportedItem(request, user, account.id, SAMPLE_COFFEE)
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const dialog = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
  const remove = dialog.getByTestId('transaction-delete')

  // Every delete sent, so one the browser should have held back shows up
  const deletesSent: string[] = []
  page.on('request', (sent) => {
    if (sent.url() === `${API_BASE_URL}/transactions/${id}` && sent.method() === 'DELETE') deletesSent.push(sent.url())
  })

  await page.getByTestId(`transaction-row-${id}`).click()
  await expect(remove).toHaveAttribute('aria-disabled', 'true')
  await expect(remove).toHaveAccessibleDescription(DELETE_LINKED_REASON)

  // Pointing at Delete shows the reason, and it follows the cursor down the button. Hovering waits for
  // Delete to stop moving, so the pointer lands where it is aimed once the modal has grown in
  const reason = page.getByText(DELETE_LINKED_REASON).filter({ visible: true })
  await remove.hover({ position: { x: POINTER_INSET_PX, y: POINTER_INSET_PX } })
  await expect.poll(() => readTooltipOpacity(reason)).toBe('1')
  const shownAt = await getBox(reason)
  await remove.hover({ position: { x: POINTER_INSET_PX, y: POINTER_INSET_PX + POINTER_STEP_PX } })
  await expect.poll(async () => Math.round((await getBox(reason)).y - shownAt.y)).toBe(POINTER_STEP_PX)

  // Pressed twice, since the first press of a free Delete only asks to confirm and the second is the
  // one that sends. Forced, because the button is marked unavailable and pressing it anyway is what is
  // checked
  await remove.click({ force: true })
  await remove.click({ force: true })
  await expect(dialog).toBeVisible()
  expect(deletesSent).toEqual([])
  await expect(remove).toHaveAccessibleName('Delete')

  // The app keeps what it last read across a reload, so this load starts without that copy and reads
  // the list afresh, as it does once unlinking refreshes it
  const unlinked = await request.delete(`${API_BASE_URL}/accounts/${account.id}/bank-link`, { headers: asUser(user) })
  expect(unlinked.ok()).toBe(true)
  await page.addInitScript(() => localStorage.removeItem('lumina:query-cache'))
  await openPage(page, `/accounts/${account.id}`)
  await page.getByTestId(`transaction-row-${id}`).click()
  await expect(remove).not.toHaveAttribute('aria-disabled')
  await remove.click()
  await expect(remove).toHaveAccessibleName('Yes, delete')
  const deleted = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/transactions/${id}` && response.request().method() === 'DELETE')
  await remove.click()
  expect((await deleted).status()).toBe(204)
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId(`transaction-row-${id}`)).toBeHidden()
})

test('greys out bulk Delete with its reason while a ticked bank transaction is in a linked account', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const manualDate = daysFromTodayInTestTimezone(-(IMPORT_START_DAYS_AGO + 2))
  const manual = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1500, date: manualDate })
  await linkToSampleBankAccount(request, user, {
    accountId: account.id,
    bankAccountName: SAMPLE_CHEQUING,
    startDate: daysFromTodayInTestTimezone(-IMPORT_START_DAYS_AGO),
  })
  const bankDate = (await addImportedItem(request, user, account.id, SAMPLE_COFFEE)).date
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)

  // Every bulk delete sent, so one the browser should have held back shows up
  const deletesSent: string[] = []
  page.on('request', (sent) => {
    if (sent.url() === `${API_BASE_URL}/transactions/bulk/delete`) deletesSent.push(sent.url())
  })

  await page.getByRole('button', { name: 'Select transactions', exact: true }).click()
  await page.getByRole('checkbox', { name: new RegExp(`^Select .+ on ${manualDate}$`) }).check()
  const deleteAction = page.getByRole('button', { name: 'Delete the selected transactions', exact: true })
  await expect(deleteAction).not.toHaveAttribute('aria-disabled')

  // Ticking the bank transaction beside the manual one refuses the pair, saying why on Delete itself
  await page.getByRole('checkbox', { name: new RegExp(`^Select .+ on ${bankDate}$`) }).check()
  await expect(deleteAction).toHaveAttribute('aria-disabled', 'true')
  await expect(deleteAction).toHaveAccessibleDescription(BULK_DELETE_LINKED_REASON)
  const reason = page.getByText(BULK_DELETE_LINKED_REASON).filter({ visible: true })
  await deleteAction.hover({ position: { x: POINTER_INSET_PX, y: POINTER_INSET_PX } })
  await expect.poll(() => readTooltipOpacity(reason)).toBe('1')

  // Forced, because the button is marked unavailable and pressing it anyway is what is checked
  await deleteAction.click({ force: true })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(deletesSent).toEqual([])
  await expect(page.getByTestId(`transaction-row-${manual}`)).toBeVisible()
})
