import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { createAccount, daysFromTodayInTestTimezone, formatDateLabel, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { addImportedItem, editTransaction, linkToEmptyBankAccount, readTransaction } from '../support/bankSync'
import { expectPendingAction, expectTransactionRow, MINUS, readBoxes } from '../support/selectors'
import { AT_EVERY_SIZE_NEEDS_BANK_SYNC, NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only for the restores of money coming in, of one edited field beside another and of an
// edit made after a restore. The other restores run at every size, with the short screen step on the phone.
// The restore action wraps under its value where the two don't fit on one line, and a phone gives the modal
// its whole screen

// The edit modal of a bank-imported transaction shows the bank's merchant and note and, under each field
// the user edited, the bank's value with Restore bank value.
//
// Everyday links to an empty bank account at Harbour Bank on the fake SimpleFIN Bridge. The Bridge has one
// transaction for each restore a test makes. The user adds each to the ledger as the bank sent it and then
// edits it, so every restore goes to the server and what it saved is read back, and no step restores a
// transaction another step reads. Only a failed restore is answered in its place, since the server can't
// be made to give one
const BANK_DESCRIPTION = 'HARBOUR CAFE #12 VANCOUVER'

// Where the modal has room for the bank's filing card beside it
const ASIDE_MIN_WIDTH = 1320
const RESTORE_FAILED = 'The bank value for this transaction is no longer available'
const UNSTORABLE_REASON = 'The bank\'s amount has more decimal places than CAD allows, so the app can\'t restore the amount'

// The day the bank booked the transaction on, and the earlier one a test moves it to
const BANK_DATE = daysFromTodayInTestTimezone(-3)
const EDITED_DATE = daysFromTodayInTestTimezone(-5)

// How far below the edge of the modal's body the action sits before the keyboard reaches it
const ACTION_OUT_OF_VIEW_PX = 6

/** A transaction the bank sends, the amount the user adds it with where the bank's can't be held, and their edit */
type BankRow = { description: string; amount: string; edit: { dt?: string; amount?: number }; added?: number }

/**
 * Signs up with Everyday, linked to Everyday Chequing at Harbour Bank. The bank sends each row's `amount`
 * on the bank's day. The user adds each to the ledger as the bank sent it, or with `added` minor units
 * where the bank's amount can't be held, then makes the edit given. Answers with each transaction's id, in
 * the rows' order
 */
async function startWithImported(page: Page, request: APIRequestContext, rows: BankRow[]): Promise<{ user: TestUser; ids: string[] }> {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await linkToEmptyBankAccount(request, user, {
    accountId: account.id,
    startDate: daysFromTodayInTestTimezone(-10),
    transactions: rows.map(({ amount, description }) => ({ posted: BANK_DATE, amount, description })),
  })
  const ids: string[] = []
  for (const { description, edit, added } of rows) {
    const { id } = await addImportedItem(request, user, account.id, description, added)
    if (Object.keys(edit).length > 0) await editTransaction(request, user, id, edit)
    ids.push(id)
  }
  await logInViaApi(page, user)
  return { user, ids }
}

/**
 * Holds the page's restores of the transaction's bank values until the returned release, for a test
 * that looks at the modal while one is under way, then sends them on to the server
 */
async function holdRestores(page: Page, id: string): Promise<() => void> {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route(`${API_BASE_URL}/bank-sync/transaction-sources/${id}/restore`, async (route) => {
    await held
    await route.fallback()
  })
  return release
}

/** Fails the page's restores of the transaction's bank values with a server error */
async function failRestores(page: Page, id: string): Promise<void> {
  await page.route(`${API_BASE_URL}/bank-sync/transaction-sources/${id}/restore`, (route) =>
    route.fulfill({ status: 409, json: { detail: RESTORE_FAILED } }))
}

/** Opens the edit modal of the transaction from its row */
async function openTransaction(page: Page, id: string): Promise<Locator> {
  await page.getByTestId(`transaction-row-${id}`).click()
  const dialog = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Closes the edit modal without saving, leaving the page as the next step needs it */
async function closeTransaction(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
}

/** The restore action under the date or the amount, found by the bank value it is described by */
function restoreAction(dialog: Locator, field: 'date' | 'amount'): Locator {
  return dialog.locator(`button[aria-describedby~="txn-${field}-bank-value"]`)
}

/**
 * Assert the first box sits below the second and starts within its left and right edges. The two are
 * measured together, since the dialogue can still be scaling in around them
 */
async function expectUnder(caption: Locator, field: Locator): Promise<void> {
  const [captionBox, fieldBox] = await readBoxes(caption.page(), [caption, field])
  expect(captionBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height - 1)
  expect(captionBox.x).toBeGreaterThanOrEqual(fieldBox.x - 1)
  expect(captionBox.x).toBeLessThan(fieldBox.x + fieldBox.width)
}

/**
 * Assert the restore action under the date or the amount is an icon with no text, on the bank value's
 * line just after it, and drawn whole inside the caption's clip
 */
async function expectIconAfterValue(dialog: Locator, field: 'date' | 'amount'): Promise<void> {
  const action = restoreAction(dialog, field)
  await expect(action).toHaveText('')
  await expect(action.locator('svg')).toHaveCount(1)
  const placement = await action.evaluate((button, valueId) => {
    const value = document.getElementById(valueId)!
    let clip = button.parentElement!
    while (getComputedStyle(clip).overflowX === 'visible') clip = clip.parentElement!
    const [actionBox, valueBox, clipBox] = [button, value, clip].map((part) => part.getBoundingClientRect())
    return {
      gap: actionBox.left - valueBox.right,
      middles: Math.abs(actionBox.top + actionBox.height / 2 - (valueBox.top + valueBox.height / 2)),
      inside: actionBox.left >= clipBox.left && actionBox.right <= clipBox.right,
    }
  }, `txn-${field}-bank-value`)
  expect(placement.gap).toBeGreaterThanOrEqual(0)
  expect(placement.gap).toBeLessThanOrEqual(8)
  expect(placement.middles).toBeLessThanOrEqual(1)
  expect(placement.inside).toBe(true)
}

// A stand-in can still be fetching for the page when a test ends. That would otherwise surface as an
// error outside any test
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('restores the bank amount and date under edited ones and says a restore failed, greying out an amount the currency can\'t hold', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, ids: [amountId, dateId, unstorableId, failingId] } = await startWithImported(page, request, [
    // The bank sent money out and the user turned it into money in
    { description: BANK_DESCRIPTION, amount: '-42.10', edit: { amount: 4210 } },
    { description: 'HARBOUR CAFE #13 VANCOUVER', amount: '-42.50', edit: { dt: EDITED_DATE } },
    // Added with an amount of the user's own. That counts as their edit
    { description: 'HARBOUR CAFE #14 VANCOUVER', amount: '-42.505', edit: {}, added: -4250 },
    { description: 'HARBOUR CAFE #15 VANCOUVER', amount: '-42.10', edit: { amount: -4000 } },
  ])
  const release = await holdRestores(page, amountId)
  await failRestores(page, failingId)
  let unstorableRestores = 0
  page.on('request', (sent) => {
    if (sent.url() === `${API_BASE_URL}/bank-sync/transaction-sources/${unstorableId}/restore`) unstorableRestores += 1
  })
  await openPage(page, '/transactions')

  await test.step('restores the bank amount under an edited amount, bringing back its sign and direction', async () => {
    await expect(page.getByTestId(`transaction-row-${amountId}`).getByTestId('bank-edited-dot').filter({ visible: true })).toBeVisible()

    // Where the window has room, the bank's filing card shows open beside the form, as a review item's does.
    // Where it hasn't, the provider heads the form closed to its own line, and opened shows the card. Either
    // way the card is read-only
    const dialog = await openTransaction(page, amountId)
    const source = dialog.getByRole('button', { name: 'From SimpleFIN', exact: true })
    const card = page.getByRole('region', { name: 'SimpleFIN filing card' })
    if (page.viewportSize()!.width >= ASIDE_MIN_WIDTH) {
      await expect(card).toBeVisible()
      await expect(source).toHaveCount(0)
      const [cardBox, formBox] = await readBoxes(page, [card, dialog.getByRole('textbox', { name: 'Amount', exact: true })])
      expect(cardBox.x).toBeGreaterThanOrEqual(formBox.x + formBox.width)

      // The tab names the provider as its header does, never in capitals. innerText reads the text as drawn
      expect(await page.getByTestId('filing-card-tab').innerText()).toBe('SimpleFIN')
    } else {
      expect(await source.innerText()).toMatch(/^FROM\s+SimpleFIN$/)
      await expect(source).toHaveAttribute('aria-expanded', 'false')
      await expect(card).toHaveCount(0)
      await source.click()
    }
    await expect(card.getByText(BANK_DESCRIPTION)).toBeVisible()
    await expect(card.getByText('Harbour Bank')).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Bank description' })).toHaveCount(0)

    // The bank's amount shows under the amount alone, the date left as it was
    const amount = dialog.getByRole('textbox', { name: 'Amount', exact: true })
    const caption = dialog.locator('#txn-amount-bank-value')
    await expect(caption).toHaveText(`Bank: ${MINUS}$42.10`)
    await expectUnder(caption, amount)
    await expectIconAfterValue(dialog, 'amount')
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
    await closeTransaction(dialog)
    await expectTransactionRow(page, amountId, `${MINUS}$42.10`)
    await expect(page.getByTestId(`transaction-row-${amountId}`).getByTestId('bank-edited-dot').filter({ visible: true })).toHaveCount(0)
    expect(await readTransaction(request, user, amountId)).toMatchObject({ amount: -4210, bank_source: { edited_fields: [] } })
  })

  await test.step('restores the bank date under an edited date, staying restored once the modal reopens', async () => {
    const dialog = await openTransaction(page, dateId)
    const date = dialog.getByRole('group', { name: 'Date' })
    const caption = dialog.locator('#txn-date-bank-value')
    await expect(caption).toHaveText(`Bank: ${formatDateLabel(BANK_DATE)}`)
    await expectUnder(caption, date)
    await expect(dialog.locator('#txn-amount-bank-value')).toHaveCount(0)

    // The icon fits after the date's bank value even in the date's narrow column beside the amount
    await expectIconAfterValue(dialog, 'date')
    await expect(date.getByRole('textbox', { name: 'Day' })).toHaveValue(EDITED_DATE.slice(8))

    await restoreAction(dialog, 'date').click()
    await expect(date.getByRole('textbox', { name: 'Day' })).toHaveValue(BANK_DATE.slice(8))
    await expect(caption).toHaveCount(0)
    await expect(date.getByRole('textbox', { name: 'Year' })).toBeFocused()

    await closeTransaction(dialog)
    const reopened = await openTransaction(page, dateId)
    await expect(reopened.getByRole('group', { name: 'Date' }).getByRole('textbox', { name: 'Day' })).toHaveValue(BANK_DATE.slice(8))
    await expect(reopened.getByRole('button', { name: 'Restore bank value' })).toHaveCount(0)
    expect(await readTransaction(request, user, dateId)).toMatchObject({ dt: BANK_DATE, bank_source: { edited_fields: [] } })
    await closeTransaction(reopened)
  })

  await test.step('greys out Restore bank value on an amount the currency can\'t hold, saying why', async () => {
    // The bank's amount shows exactly as sent, and the action shows greyed out, described by why
    const dialog = await openTransaction(page, unstorableId)
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
    expect(unstorableRestores).toBe(0)

    // Reached from the amount by the keyboard, it shows the reason under it. Where the modal's body scrolls,
    // it is first scrolled to leave the action just out of view below, so the press scrolls it in
    await restore.evaluate((action, outOfView) => {
      let body = action.parentElement!
      while (!/auto|scroll/.test(getComputedStyle(body).overflowY)) body = body.parentElement!
      body.scrollTop += action.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom - outOfView
    }, ACTION_OUT_OF_VIEW_PX)
    await amount.evaluate((field) => field.focus({ preventScroll: true }))
    await page.keyboard.press('Tab')
    await expect(restore).toBeFocused()
    await expect(reason).toHaveCSS('opacity', '1')

    // Its focus ring keeps its full strength, since only the label fades, and whole, since every box that
    // clips the action leaves room for as far as the ring reaches outside it, the body it scrolled in too
    const ring = await restore.evaluate((button) => {
      const rect = button.getBoundingClientRect()
      const drawn = getComputedStyle(button)
      const reach = parseFloat(drawn.outlineOffset) + parseFloat(drawn.outlineWidth)
      let opacity = 1
      let room = Number.POSITIVE_INFINITY
      for (let box: Element | null = button; box; box = box.parentElement) {
        const style = getComputedStyle(box)
        opacity *= Number(style.opacity)
        if (box === button || (style.overflowX === 'visible' && style.overflowY === 'visible')) continue
        const bounds = box.getBoundingClientRect()
        room = Math.min(room, rect.top - bounds.top, bounds.bottom - rect.bottom, rect.left - bounds.left, bounds.right - rect.right)
      }
      return { opacity, room, reach }
    })
    expect(ring.opacity).toBe(1)
    expect(ring.reach).toBeGreaterThan(0)
    expect(ring.room).toBeGreaterThanOrEqual(ring.reach)
    await closeTransaction(dialog)
  })

  await test.step('says a restore failed, leaving the field and its bank value to try again', async () => {
    const dialog = await openTransaction(page, failingId)
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
    await closeTransaction(dialog)
  })

  // Last, since it resizes the window to a short screen and opens the page again
  if (test.info().project.name === 'phone') {
    await test.step('brings a failed restore into view above the footer, from an action at the foot of a short screen', async () => {
      await page.setViewportSize({ width: 390, height: 667 })
      await openPage(page, '/transactions')

      // The form scrolls until the amount's action sits just above the footer. The failure would
      // open underneath it. The footer is the part of the modal holding Save that doesn't hold the form
      const dialog = await openTransaction(page, failingId)
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
  }
})

test('restores money coming in, one of two edited fields beside the other and an edit made after a restore', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, ids: [incomingId, bothId, flippedId] } = await startWithImported(page, request, [
    // The bank sent money in and the user turned it into money out
    { description: BANK_DESCRIPTION, amount: '50.00', edit: { amount: -5000 } },
    { description: 'HARBOUR CAFE #13 VANCOUVER', amount: '-42.10', edit: { dt: EDITED_DATE, amount: -4000 } },
    { description: 'HARBOUR CAFE #14 VANCOUVER', amount: '-42.10', edit: { amount: 4210 } },
  ])
  const release = await holdRestores(page, bothId)
  await openPage(page, '/transactions')

  await test.step('restores money coming in, bringing back the Credit direction', async () => {
    const dialog = await openTransaction(page, incomingId)
    await expect(dialog.locator('#txn-amount-bank-value')).toHaveText('Bank: +$50.00')
    await expect(dialog.getByRole('tab', { name: 'Debit', exact: true })).toHaveAttribute('aria-selected', 'true')

    await restoreAction(dialog, 'amount').click()
    await expect(dialog.getByRole('tab', { name: 'Credit', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByRole('textbox', { name: 'Amount', exact: true })).toHaveValue('50.00')
    await expect(dialog.locator('#txn-amount-bank-value')).toHaveCount(0)
    expect(await readTransaction(request, user, incomingId)).toMatchObject({ amount: 5000, bank_source: { edited_fields: [] } })
    await closeTransaction(dialog)
  })

  await test.step('restores one of two edited fields, holding the other back while it restores', async () => {
    const dialog = await openTransaction(page, bothId)
    await expect(dialog.locator('#txn-date-bank-value')).toHaveText(`Bank: ${formatDateLabel(BANK_DATE)}`)
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
    await expect(dialog.locator('#txn-date-bank-value')).toHaveText(`Bank: ${formatDateLabel(BANK_DATE)}`)
    await expect(dialog.getByRole('group', { name: 'Date' }).getByRole('textbox', { name: 'Day' })).toHaveValue(EDITED_DATE.slice(8))
    await expect(restoreDate).toBeEnabled()
    expect(await readTransaction(request, user, bothId)).toMatchObject({ dt: EDITED_DATE, amount: -4210, bank_source: { edited_fields: ['date'] } })
    await closeTransaction(dialog)
  })

  await test.step('saves an edit made after a restore in the same modal, compared with the restored value', async () => {
    const dialog = await openTransaction(page, flippedId)
    await restoreAction(dialog, 'amount').click()
    await expect(dialog.getByRole('tab', { name: 'Debit', exact: true })).toHaveAttribute('aria-selected', 'true')

    // Turning it back into money in matches the transaction as the modal opened, but not as the restore
    // saved it, so the save still sends it
    await dialog.getByRole('tab', { name: 'Credit', exact: true }).click()
    await dialog.getByTestId('transaction-submit').click()
    await expect(dialog).toBeHidden()
    await expectTransactionRow(page, flippedId, '+$42.10')
    expect(await readTransaction(request, user, flippedId)).toMatchObject({ amount: 4210, bank_source: { edited_fields: ['amount'] } })
  })
})
