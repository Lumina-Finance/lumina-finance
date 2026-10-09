import { expect, test, type APIRequestContext, type Locator, type Page, type Route } from '@playwright/test'

import { asUser, createAccount, createTransaction, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { answerAsBankImported, BANK_SOURCE, type BankSource } from '../support/bankSync'
import { expectPendingAction, expectTransactionRow, MINUS, readBoxes } from '../support/selectors'
import { API_BASE_URL } from '../support/target'

// The edit modal of a bank-imported transaction shows the bank's description and, under each field
// the user edited, the bank's value with Restore bank value. Nothing links an account on the server
// for a sync to import a transaction, so each test answers the app's reads with the source the server
// attaches, and answers a restore by writing the bank's value to the real transaction, as the server
// does, then answering with the source as the restore left it. That stand-in tests the modal alone:
// the real restore route, its refusals and its locking are left to the backend route tests
const BANK_DESCRIPTION = 'HARBOUR CAFE #12 VANCOUVER'
const RESTORE_FAILED = 'Could not restore the bank value. Please try again.'
const UNSTORABLE_REASON = 'The bank\'s amount has more decimal places than CAD allows, so it can\'t be restored.'

/** A bank source sending these values, with these fields edited in the ledger */
function bankSource(values: Partial<BankSource['bank_values']>, editedFields: BankSource['edited_fields']): BankSource {
  return {
    ...BANK_SOURCE,
    bank_values: { ...BANK_SOURCE.bank_values, description: BANK_DESCRIPTION, ...values },
    edited_fields: editedFields,
  }
}

/**
 * Answers a restore of the transaction by writing the bank's value for the field to it through the
 * real server and taking the field out of its source's edited ones, so every later read agrees. The
 * answer waits on the returned release, for a test that looks at the modal while it restores
 */
async function answerRestores(
  page: Page,
  request: APIRequestContext,
  user: TestUser,
  sources: Record<string, BankSource>,
  id: string,
): Promise<() => void> {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route(`${API_BASE_URL}/bank-sync/transaction-sources/${id}/restore`, async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const { field } = route.request().postDataJSON() as { field: 'date' | 'amount' }
    await held

    const { bank_values: bank } = sources[id]
    const response = await request.patch(`${API_BASE_URL}/transactions/${id}`, {
      headers: asUser(user),
      data: field === 'date' ? { dt: bank.date } : { amount: bank.amount },
    })
    expect(response.ok(), `writing the bank's ${field} answered ${response.status()}: ${await response.text()}`).toBe(true)
    sources[id] = { ...sources[id], edited_fields: sources[id].edited_fields.filter((edited) => edited !== field) }
    await route.fulfill({ json: { ...await response.json(), bank_source: sources[id] } })
  })
  return release
}

/** Opens the edit modal of the transaction from its row */
async function openTransaction(page: Page, id: string): Promise<Locator> {
  await page.getByTestId(`transaction-row-${id}`).click()
  const dialog = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

/** The restore action under the date or the amount, found by the bank value it is described by */
function restoreAction(dialog: Locator, field: 'date' | 'amount'): Locator {
  return dialog.locator(`button[aria-describedby~="txn-${field}-bank-value"]`)
}

/**
 * Assert the first box sits below the second and starts within its left and right edges. The two are
 * measured together, since the dialog can still be scaling in around them
 */
async function expectUnder(caption: Locator, field: Locator): Promise<void> {
  const [captionBox, fieldBox] = await readBoxes(caption.page(), [caption, field])
  expect(captionBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height - 1)
  expect(captionBox.x).toBeGreaterThanOrEqual(fieldBox.x - 1)
  expect(captionBox.x).toBeLessThan(fieldBox.x + fieldBox.width)
}

/**
 * Assert the restore action under the date or the amount follows a dot beside the bank's value or,
 * where the two don't fit on one line, starts a line of its own in line with the value, its dot cut off
 * by the caption's clip. Returns whether the action has a line of its own
 */
async function expectActionPlacement(dialog: Locator, field: 'date' | 'amount'): Promise<boolean> {
  const placement = await restoreAction(dialog, field).evaluate((action, valueId) => {
    const dot = action.previousElementSibling!
    const value = document.getElementById(valueId)!
    let clip = action.parentElement!
    while (getComputedStyle(clip).overflowX === 'visible') clip = clip.parentElement!
    const [actionBox, dotBox, valueBox, clipBox] = [action, dot, value, clip].map((part) => part.getBoundingClientRect())
    return {
      ownLine: actionBox.top >= valueBox.bottom - 0.5,
      dotShown: dotBox.left >= clipBox.left && dotBox.right <= clipBox.right,
      dotBetween: dotBox.left >= valueBox.right - 0.5 && dotBox.right <= actionBox.left + 0.5,
      indent: actionBox.left - valueBox.left,
    }
  }, `txn-${field}-bank-value`)

  if (placement.ownLine) {
    expect(placement.dotShown, 'the dot before an action on a line of its own').toBe(false)
    expect(Math.abs(placement.indent)).toBeLessThanOrEqual(1)
  } else {
    expect(placement.dotShown, 'the dot between the bank value and the action').toBe(true)
    expect(placement.dotBetween).toBe(true)
  }
  return placement.ownLine
}

// A stand-in can still be fetching for the page when a test ends, which would otherwise surface as an
// error outside any test
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('restores the bank amount under an edited amount, bringing back its sign and direction', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })

  // The bank sent money out, which the user turned into money in
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: 4210,
    date: BANK_SOURCE.bank_values.date,
  })
  const sources = { [id]: bankSource({ amount: -4210 }, ['amount']) }
  await answerAsBankImported(page, sources)
  const release = await answerRestores(page, request, user, sources, id)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(`transaction-row-${id}`).getByTestId('bank-edited-dot').filter({ visible: true })).toBeVisible()

  // The provider and the bank's description head the form, read-only
  const dialog = await openTransaction(page, id)
  await expect(dialog.getByText('From SimpleFIN', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('definition').filter({ hasText: BANK_DESCRIPTION })).toBeVisible()
  await expect(dialog.getByRole('term').filter({ hasText: 'Bank description' })).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Bank description' })).toHaveCount(0)

  // The bank's amount shows under the amount alone, the date left as it was
  const amount = dialog.getByRole('textbox', { name: 'Amount', exact: true })
  const caption = dialog.locator('#txn-amount-bank-value')
  await expect(caption).toHaveText(`Bank: ${MINUS}$42.10`)
  await expectUnder(caption, amount)
  await expectActionPlacement(dialog, 'amount')
  await expect(dialog.locator('#txn-date-bank-value')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Restore bank value' })).toHaveCount(1)
  await expect(amount).toHaveValue('42.10')
  await expect(dialog.getByRole('tab', { name: 'Credit', exact: true })).toHaveAttribute('aria-selected', 'true')

  // While it restores, the action says so and the modal takes no save
  const restore = restoreAction(dialog, 'amount')
  await expect(restore).toHaveAccessibleName('Restore bank value')
  await restore.click()
  await expectPendingAction(restore, 'Restoring')
  await expect(dialog.getByTestId('transaction-submit')).toBeDisabled()
  release()

  // The amount reads the bank's, money out again, and nothing is left to restore, so focus moves to
  // the amount from the action that went with its caption
  await expect(dialog.getByRole('tab', { name: 'Debit', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(amount).toHaveValue('42.10')
  await expect(amount).toBeFocused()
  await expect(caption).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /Restor/ })).toHaveCount(0)
  await expect(dialog.getByText(RESTORE_FAILED)).toHaveCount(0)
  await expect(dialog.getByTestId('transaction-submit')).toBeEnabled()

  // The restore was saved, so the row has the bank's amount and loses its edited dot
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expectTransactionRow(page, id, `${MINUS}$42.10`)
  await expect(page.getByTestId(`transaction-row-${id}`).getByTestId('bank-edited-dot').filter({ visible: true })).toHaveCount(0)
})

test('restores money coming in, bringing back the Credit direction', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })

  // The bank sent money in, which the user turned into money out
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -5000,
    date: BANK_SOURCE.bank_values.date,
  })
  const sources = { [id]: bankSource({ amount: 5000 }, ['amount']) }
  await answerAsBankImported(page, sources)
  const release = await answerRestores(page, request, user, sources, id)
  release()
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const dialog = await openTransaction(page, id)
  await expect(dialog.locator('#txn-amount-bank-value')).toHaveText('Bank: +$50.00')
  await expect(dialog.getByRole('tab', { name: 'Debit', exact: true })).toHaveAttribute('aria-selected', 'true')

  await restoreAction(dialog, 'amount').click()
  await expect(dialog.getByRole('tab', { name: 'Credit', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByRole('textbox', { name: 'Amount', exact: true })).toHaveValue('50.00')
  await expect(dialog.locator('#txn-amount-bank-value')).toHaveCount(0)
})

test('restores one of two edited fields, holding the other back while it restores', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4000,
    date: '2026-01-13',
  })
  const sources = { [id]: bankSource({ amount: -4210 }, ['date', 'amount']) }
  await answerAsBankImported(page, sources)
  const release = await answerRestores(page, request, user, sources, id)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const dialog = await openTransaction(page, id)
  await expect(dialog.locator('#txn-date-bank-value')).toHaveText('Bank: Jan 15, 2026')
  await expect(dialog.locator('#txn-amount-bank-value')).toHaveText(`Bank: ${MINUS}$42.10`)

  // Only the amount reads Restoring, and the date's action waits for it
  const restoreDate = restoreAction(dialog, 'date')
  const restoreAmount = restoreAction(dialog, 'amount')
  await restoreAmount.click()
  await expectPendingAction(restoreAmount, 'Restoring')
  await expect(restoreDate).toHaveAccessibleName('Restore bank value')
  await expect(restoreDate).toBeDisabled()
  await expect(restoreDate).not.toHaveAttribute('aria-busy', 'true')
  release()

  // The amount is restored and the date is still the user's own, with its action back
  await expect(dialog.locator('#txn-amount-bank-value')).toHaveCount(0)
  await expect(dialog.getByRole('textbox', { name: 'Amount', exact: true })).toHaveValue('42.10')
  await expect(dialog.locator('#txn-date-bank-value')).toHaveText('Bank: Jan 15, 2026')
  await expect(dialog.getByRole('group', { name: 'Date' }).getByRole('textbox', { name: 'Day' })).toHaveValue('13')
  await expect(restoreDate).toBeEnabled()
})

test('saves an edit made after a restore in the same modal, compared with the restored value', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: 4210,
    date: BANK_SOURCE.bank_values.date,
  })
  const sources = { [id]: bankSource({ amount: -4210 }, ['amount']) }
  await answerAsBankImported(page, sources)
  const release = await answerRestores(page, request, user, sources, id)
  release()
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const dialog = await openTransaction(page, id)
  await restoreAction(dialog, 'amount').click()
  await expect(dialog.getByRole('tab', { name: 'Debit', exact: true })).toHaveAttribute('aria-selected', 'true')

  // Turning it back into money in matches the transaction as the modal opened, but not as the restore
  // saved it, so the save still sends it
  await dialog.getByRole('tab', { name: 'Credit', exact: true }).click()
  await dialog.getByTestId('transaction-submit').click()
  await expect(dialog).toBeHidden()
  await expectTransactionRow(page, id, '+$42.10')
})

test('restores the bank date under an edited date, which stays restored once the modal reopens', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: BANK_SOURCE.bank_values.amount!,
    date: '2026-01-13',
  })
  const sources = { [id]: bankSource({}, ['date']) }
  await answerAsBankImported(page, sources)
  const release = await answerRestores(page, request, user, sources, id)
  release()
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const dialog = await openTransaction(page, id)
  const date = dialog.getByRole('group', { name: 'Date' })
  const caption = dialog.locator('#txn-date-bank-value')
  await expect(caption).toHaveText('Bank: Jan 15, 2026')
  await expectUnder(caption, date)
  await expect(dialog.locator('#txn-amount-bank-value')).toHaveCount(0)

  // Beside the amount, the date's column is too narrow for the value and the action together, so the
  // action takes a line of its own. Stacked on a phone, both fit on one line
  const [dateBox, amountBox] = await readBoxes(page, [date, dialog.getByRole('textbox', { name: 'Amount', exact: true })])
  expect(await expectActionPlacement(dialog, 'date')).toBe(amountBox.x >= dateBox.x + dateBox.width)
  await expect(date.getByRole('textbox', { name: 'Day' })).toHaveValue('13')

  await restoreAction(dialog, 'date').click()
  await expect(date.getByRole('textbox', { name: 'Day' })).toHaveValue('15')
  await expect(caption).toHaveCount(0)
  await expect(date.getByRole('textbox', { name: 'Year' })).toBeFocused()

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
  const reopened = await openTransaction(page, id)
  await expect(reopened.getByRole('group', { name: 'Date' }).getByRole('textbox', { name: 'Day' })).toHaveValue('15')
  await expect(reopened.getByRole('button', { name: 'Restore bank value' })).toHaveCount(0)
})

test('says a restore failed, leaving the field and its bank value to try again', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4000,
    date: BANK_SOURCE.bank_values.date,
  })
  await answerAsBankImported(page, { [id]: bankSource({ amount: -4210 }, ['amount']) })
  await page.route(`${API_BASE_URL}/bank-sync/transaction-sources/${id}/restore`, (route) =>
    route.fulfill({ status: 500, json: { detail: 'Internal Server Error' } }))
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const dialog = await openTransaction(page, id)
  const restore = restoreAction(dialog, 'amount')
  await restore.focus()
  await page.keyboard.press('Enter')

  // The failure shows once, by the field it was restoring, in view on every screen, and focus stays
  // on the action, ready to try again
  const failure = dialog.getByRole('alert').filter({ hasText: RESTORE_FAILED })
  await expect(failure).toBeVisible()
  await expect(dialog.getByText(RESTORE_FAILED)).toHaveCount(1)
  await expect(failure).toBeInViewport()
  await expectUnder(failure, dialog.locator('#txn-amount-bank-value'))
  await expect(restore).toBeFocused()
  await expect(dialog.getByRole('textbox', { name: 'Amount', exact: true })).toHaveValue('40.00')
  await expect(dialog.locator('#txn-amount-bank-value')).toHaveText(`Bank: ${MINUS}$42.10`)
  await expect(restore).toHaveAccessibleName('Restore bank value')
  await expect(restore).toBeEnabled()
})

test('brings a failed restore into view above the footer, from an action at the foot of a short screen', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4000,
    date: BANK_SOURCE.bank_values.date,
  })
  await answerAsBankImported(page, { [id]: bankSource({ amount: -4210 }, ['amount']) })
  await page.route(`${API_BASE_URL}/bank-sync/transaction-sources/${id}/restore`, (route) =>
    route.fulfill({ status: 500, json: { detail: 'Internal Server Error' } }))
  await page.setViewportSize({ width: 390, height: 667 })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  // The form scrolls until the amount's action sits just above the footer, where the failure would
  // open underneath it. The footer is the part of the modal holding Save that doesn't hold the form
  const dialog = await openTransaction(page, id)
  const restore = restoreAction(dialog, 'amount')
  const footerTop = await restore.evaluate((action) => {
    const save = document.querySelector('[data-testid="transaction-submit"]')!
    let footer = save
    while (!footer.parentElement!.contains(action)) footer = footer.parentElement!
    let form = action.parentElement!
    while (!/auto|scroll/.test(getComputedStyle(form).overflowY)) form = form.parentElement!
    form.scrollTop += action.getBoundingClientRect().bottom - (footer.getBoundingClientRect().top - 4)
    return footer.getBoundingClientRect().top
  })
  expect((await restore.boundingBox())!.y).toBeGreaterThan(footerTop - 40)

  // Once it has opened, the failure shows in full above the footer, and focus stays on the action
  await restore.focus()
  await page.keyboard.press('Enter')
  const failure = dialog.getByRole('alert').filter({ hasText: RESTORE_FAILED })
  await expect(failure).toBeVisible()
  await expect.poll(async () => {
    const box = (await failure.boundingBox())!
    return box.y + box.height
  }).toBeLessThanOrEqual(footerTop)
  await expect(restore).toBeFocused()
})

test('greys out Restore bank value on an amount the currency can\'t hold, saying why', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4250,
    date: BANK_SOURCE.bank_values.date,
  })
  await answerAsBankImported(page, { [id]: bankSource({ amount: null, raw_amount: '-42.505' }, ['amount']) })
  let restores = 0
  await page.route(`${API_BASE_URL}/bank-sync/transaction-sources/${id}/restore`, (route) => {
    restores += 1
    return route.abort()
  })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  // The bank's amount shows exactly as sent, and the action shows greyed out, described by why
  const dialog = await openTransaction(page, id)
  const amount = dialog.getByRole('textbox', { name: 'Amount', exact: true })
  await expect(dialog.locator('#txn-amount-bank-value')).toHaveText(`Bank: ${MINUS}$42.505`)
  const restore = restoreAction(dialog, 'amount')
  await expect(restore).toHaveAccessibleName('Restore bank value')
  await expect(restore).toHaveAttribute('aria-disabled', 'true')
  await expect(restore).toHaveAccessibleDescription(`Bank: ${MINUS}$42.505 ${UNSTORABLE_REASON}`)

  // Pointing at it shows the reason beside it, and pressing it restores nothing. Forced, because the
  // action is marked unavailable and pressing it anyway is what is checked
  const reason = page.getByTestId('disabled-reason-tooltip').filter({ hasText: UNSTORABLE_REASON })
  await restore.hover()
  await expect(reason).toHaveCSS('opacity', '1')
  await restore.click({ force: true })
  await page.mouse.move(0, 0)
  // A tap pins the reason where there is no hover, so Escape puts it away there
  if (!(await page.evaluate(() => matchMedia('(hover: hover)').matches))) await page.keyboard.press('Escape')
  // Faded out, or gone from the page once its fade has ended
  await expect.poll(() => reason.evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).opacity === '0'))).toBe(true)
  await expect(amount).toHaveValue('42.50')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  expect(restores).toBe(0)

  // Reached from the amount by the keyboard, it shows the reason under it
  await amount.focus()
  await page.keyboard.press('Tab')
  await expect(restore).toBeFocused()
  await expect(reason).toHaveCSS('opacity', '1')

  // Its focus ring keeps its full strength, since only the label fades, and whole, since every box that
  // clips the action leaves room for the 2px Chrome draws the ring outside it
  const ring = await restore.evaluate((button) => {
    const rect = button.getBoundingClientRect()
    let opacity = 1
    let room = Number.POSITIVE_INFINITY
    for (let box: Element | null = button; box; box = box.parentElement) {
      const style = getComputedStyle(box)
      opacity *= Number(style.opacity)
      if (box === button || (style.overflowX === 'visible' && style.overflowY === 'visible')) continue
      const bounds = box.getBoundingClientRect()
      room = Math.min(room, rect.top - bounds.top, bounds.bottom - rect.bottom, rect.left - bounds.left, bounds.right - rect.right)
    }
    return { opacity, room }
  })
  expect(ring.opacity).toBe(1)
  expect(ring.room).toBeGreaterThanOrEqual(2)
})
