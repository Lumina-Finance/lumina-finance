import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import {
  asUser,
  countLedgerTransactions,
  createAccount,
  createTransaction,
  daysFromTodayInTestTimezone,
  formatDateLabel,
  signUpUser,
  type TestUser,
} from '../support/api'
import { fact, logInViaApi } from '../support/app'
import {
  errorToast,
  linkToSampleBankAccount,
  openBankLink,
  openBankLinkHoldingRead,
  waitForEntrance,
  WORKER_RESULT_TIMEOUT_MS,
} from '../support/bankSync'
import { contrastOf, MIN_TEXT_CONTRAST, MINUS, readBoxes } from '../support/selectors'
import { API_BASE_URL } from '../support/target'

// The one-time opening adjustment a linked account offers once its import is in with nothing left to
// review, at the foot of the Bank link section's balance panel, run by the worker against the fake
// SimpleFIN Bridge. Everyday holds 1,000.00 from yesterday, and SimpleFIN's balance is 1,250.00, so
// the link imports from today, nothing comes in to review, and 250.00 is offered, dated yesterday.
// The offer's words, its sign and the cache writes behind each answer are covered by unit tests
const SAMPLE_CHEQUING = 'Everyday Chequing'
const OPENING_BALANCE_STATUS = 'Opening balance to confirm'
const ZERO_AMOUNT_MESSAGE = 'Enter more than zero'
const SIGNED_AMOUNT_MESSAGE = 'Leave out the sign'

// The width from which the amount and the answers share a row
const OFFER_ROW_MIN_WIDTH = 640

type Setup = { user: TestUser; accountId: string; adjustmentDate: string }

/** The offer's controls in the account's edit modal */
type Offer = { dialog: Locator; sentence: Locator; amount: Locator; skip: Locator; record: Locator; zeroMessage: Locator }

/** Signs up with Everyday holding 1,000.00 from yesterday, linked to the sample chequing account reading 1,250.00 */
async function linkWithGap(request: APIRequestContext): Promise<Setup> {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const adjustmentDate = daysFromTodayInTestTimezone(-1)
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 100000, date: adjustmentDate })
  await linkToSampleBankAccount(request, user, { accountId: account.id, bankAccountName: SAMPLE_CHEQUING, balances: { balance: '1250.00' } })
  return { user, accountId: account.id, adjustmentDate }
}

/** Links Everyday with its gap, logs in and opens the offer */
async function openOffer(page: Page, request: APIRequestContext): Promise<{ setup: Setup; offer: Offer }> {
  const setup = await linkWithGap(request)
  await logInViaApi(page, setup.user)
  const dialog = await openBankLink(page, setup.accountId, OPENING_BALANCE_STATUS)
  const offer = {
    dialog,
    sentence: offerText(dialog, setup.adjustmentDate),
    amount: dialog.getByRole('textbox', { name: 'Adjustment amount' }),
    skip: dialog.getByRole('button', { name: 'Skip', exact: true }),
    record: dialog.getByRole('button', { name: 'Record adjustment' }),
    zeroMessage: dialog.getByText(ZERO_AMOUNT_MESSAGE),
  }
  await expect(offer.sentence).toBeVisible()
  return { setup, offer }
}

/** The offer's sentence, naming the day before the import start as the app writes a day with its year */
function offerText(dialog: Locator, adjustmentDate: string): Locator {
  return dialog.getByText(`Record the difference as an opening adjustment on ${formatDateLabel(adjustmentDate)}, so your ledger starts at SimpleFIN's balance.`)
}

/** The bodies of the answers the page sends */
function watchAnswers(page: Page): string[] {
  const sent: string[] = []
  page.on('request', (request) => {
    if (/\/bank-link\/opening-adjustment\/(record|skip)$/.test(request.url())) {
      sent.push(`${request.url().split('/').pop()} ${request.postData() ?? ''}`.trim())
    }
  })
  return sent
}

/** The account's ledger transactions as stored, as their dates and amounts, smallest amount first, and their notes */
async function readLedger(request: APIRequestContext, { user, accountId }: Setup): Promise<{ rows: [string, number][]; notes: (string | null)[] }> {
  const response = await request.get(`${API_BASE_URL}/transactions?account_id=${accountId}`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  const stored = ((await response.json()) as { dt: string; amount: number; notes: string | null }[]).sort((a, b) => a.amount - b.amount)
  return { rows: stored.map(({ dt, amount }) => [dt, amount]), notes: stored.map(({ notes }) => notes) }
}

// A request held or refused here can still be on its way to the page when a test ends, which would
// otherwise surface as an error outside any test
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('offers the gap under the balances, starting from the offered amount', async ({ page, request }) => {
  const { offer } = await openOffer(page, request)

  await expect(fact(offer.dialog, 'Status')).toHaveText(new RegExp(`^${OPENING_BALANCE_STATUS}`))
  await expect(fact(offer.dialog, /^Difference/)).toHaveText(`${MINUS}$250.00`)
  await expect(offer.amount).toHaveValue('250.00')
  await expect(offer.amount).toHaveAccessibleDescription('Your ledger records this amount as positive.')
  await expect(offer.zeroMessage).toBeHidden()
  const [caption, sentence] = await readBoxes(page, [offer.dialog.getByText(/^As of /), offer.sentence])
  expect(sentence.y).toBeGreaterThan(caption.y + caption.height)
})

test('shows the answers whole, beside the amount from the width they fit there and a row each under it on a phone', async ({ page, request }) => {
  const { offer } = await openOffer(page, request)

  const [field, skipBox, recordBox] = await readBoxes(page, [offer.amount, offer.skip, offer.record])
  expect(await offer.record.evaluate((button) => button.scrollWidth <= button.clientWidth)).toBe(true)
  if (page.viewportSize()!.width >= OFFER_ROW_MIN_WIDTH) {
    expect(Math.abs((skipBox.y + skipBox.height) - (field.y + field.height))).toBeLessThan(0.5)
    expect(recordBox.x).toBeGreaterThan(skipBox.x + skipBox.width)
  } else {
    expect(skipBox.y).toBeGreaterThan(field.y + field.height)
    expect(recordBox.y).toBeGreaterThan(skipBox.y + skipBox.height)
    expect(Math.abs(skipBox.width - recordBox.width)).toBeLessThan(0.5)
  }
})

test('keeps the amount and the answers in place on a phone when a message shows beside the label', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { offer } = await openOffer(page, request)

  // Each control's place below the sentence, which scrolling the modal moves alike
  const placed = async () => {
    const [sentence, ...controls] = await readBoxes(page, [offer.sentence, offer.amount, offer.skip, offer.record])
    return controls.map(({ y }) => Math.round(y - sentence.y))
  }
  await waitForEntrance(offer.dialog)
  const before = await placed()

  await offer.amount.fill('0')
  await offer.record.click()
  await expect(offer.zeroMessage).toBeVisible()
  expect(await placed()).toEqual(before)

  // Every frame while one message gives way to the other: the field's place, where a click on an
  // answer would otherwise land off, and whether two messages still showing cross, which neither
  // could then be read through
  type Frame = { place: number; crossing: boolean }
  const sampling = offer.sentence.evaluate((sentence, field) => new Promise<Frame[]>((resolve) => {
    const row = document.querySelector(`label[for="${field!.id}"]`)!.parentElement!
    const frames: Frame[] = []
    const start = performance.now()
    const sample = () => {
      const shown = [...row.querySelectorAll('p')]
        .filter((message) => Number(getComputedStyle(message).opacity) > 0)
        .map((message) => message.getBoundingClientRect())
      const crossing = shown.some((a, i) => shown.slice(i + 1).some((b) =>
        a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom))
      frames.push({ place: Math.round(field!.getBoundingClientRect().top - sentence.getBoundingClientRect().top), crossing })
      if (performance.now() - start < 600) requestAnimationFrame(sample)
      else resolve(frames)
    }
    requestAnimationFrame(sample)
  }), await offer.amount.elementHandle())
  await offer.amount.fill('-1')
  const frames = await sampling
  await expect(offer.dialog.getByText(SIGNED_AMOUNT_MESSAGE)).toBeVisible()
  await expect(offer.zeroMessage).toBeHidden()
  expect([...new Set(frames.map(({ place }) => place))]).toEqual([before[0]])
  expect(frames.filter(({ crossing }) => crossing)).toEqual([])
  expect(await placed()).toEqual(before)
})

test('records nothing for Enter in the amount, or for a blank or zero amount, saying why until the amount changes', async ({ page, request }) => {
  const answers = watchAnswers(page)
  const { offer } = await openOffer(page, request)

  // Enter presses neither answer nor the account's Save
  await offer.amount.press('Enter')
  await expect(offer.dialog).toBeVisible()

  await offer.amount.fill('')
  await offer.record.click()
  await expect(offer.zeroMessage).toBeVisible()
  await offer.amount.fill('0')
  await expect(offer.zeroMessage).toBeHidden()
  await offer.record.click()
  await expect(offer.zeroMessage).toBeVisible()
  await expect(offer.sentence).toBeVisible()
  expect(answers).toEqual([])
})

test('says why the amount refuses a sign typed into it, keeping the amount it holds until the sign is taken back', async ({ page, request }) => {
  const { offer } = await openOffer(page, request)
  const signMessage = offer.dialog.getByText(SIGNED_AMOUNT_MESSAGE)

  await offer.amount.fill('-240.00')
  await expect(signMessage).toBeVisible()
  await expect(offer.amount).toHaveValue('250.00')
  await expect(offer.amount).toHaveAttribute('aria-invalid', 'true')

  // Deleting where there is nothing to delete changes no text, yet takes the refused sign back
  await offer.amount.press('Home')
  await offer.amount.press('Backspace')
  await expect(signMessage).toBeHidden()
  await offer.amount.fill('+240.00')
  await expect(signMessage).toBeVisible()
  await offer.amount.press('End')
  await offer.amount.press('Delete')
  await expect(signMessage).toBeHidden()
  await expect(offer.amount).toHaveValue('250.00')

  await offer.amount.fill('-240.00')
  await expect(signMessage).toBeVisible()
  await offer.amount.fill('240.00')
  await expect(signMessage).toBeHidden()
  await expect(offer.amount).toHaveValue('240.00')
})

test('records the amount typed over the offer as one adjustment the day before the import start, and offers it no more', async ({ page, request }) => {
  const answers = watchAnswers(page)
  const { setup, offer } = await openOffer(page, request)

  // What the amount typed leaves of the gap stays as the difference, and focus moves on to Sync now
  // as the offer folds away with the button holding it
  await offer.amount.fill('240.00')
  await offer.record.click()
  await expect(offer.dialog.getByRole('button', { name: 'Sync now' })).toBeFocused()
  await expect(offer.sentence).toBeHidden()
  await expect(fact(offer.dialog, 'Ledger')).toHaveText('$1,240.00')
  await expect(fact(offer.dialog, /^Difference/)).toHaveText(`${MINUS}$10.00`)
  await expect(fact(offer.dialog, 'Status')).toHaveText(/^Synced/)
  expect(answers).toEqual(['record {"amount":24000}'])
  const ledger = await readLedger(request, setup)
  expect(ledger.rows).toEqual([[setup.adjustmentDate, 24000], [setup.adjustmentDate, 100000]])
  expect(ledger.notes[0]).toBe('Opening adjustment')

  await page.reload()
  const again = await openBankLink(page, setup.accountId, /Synced (just now|\d+ minutes? ago)\./)
  await expect(fact(again, /^Difference/)).toHaveText(`${MINUS}$10.00`)
  await expect(again.getByRole('button', { name: 'Record adjustment' })).toHaveCount(0)
})

test('skips the offer without recording anything, and offers it no more', async ({ page, request }) => {
  const answers = watchAnswers(page)
  const { setup, offer } = await openOffer(page, request)

  await offer.skip.click()
  await expect(offer.dialog.getByRole('button', { name: 'Sync now' })).toBeFocused()
  await expect(offer.sentence).toBeHidden()
  await expect(fact(offer.dialog, 'Status')).toHaveText(/^Synced/)
  await expect(fact(offer.dialog, /^Difference/)).toHaveText(`${MINUS}$250.00`)
  expect(answers).toEqual(['skip'])
  expect(await countLedgerTransactions(request, setup.user)).toBe(1)

  await page.reload()
  const again = await openBankLink(page, setup.accountId, /Synced (just now|\d+ minutes? ago)\./)
  await expect(again.getByRole('button', { name: 'Record adjustment' })).toHaveCount(0)
})

test('keeps the offer when an answer never reaches the server, saying something went wrong', async ({ page, request }) => {
  const { setup, offer } = await openOffer(page, request)
  await page.route(`${API_BASE_URL}/accounts/${setup.accountId}/bank-link/opening-adjustment/record`, (route) => route.abort('failed'), { times: 1 })

  await offer.record.click()

  await expect(errorToast(page, 'Oops, something went wrong. Please try again.')).toBeVisible()
  await expect(offer.sentence).toBeVisible()
  expect(await countLedgerTransactions(request, setup.user)).toBe(1)
})

test('folds the offer away when an answer finds it skipped in another window, saying why', async ({ page, request }) => {
  const { setup, offer } = await openOffer(page, request)
  let skippedElsewhere = 0
  await page.route(`${API_BASE_URL}/accounts/${setup.accountId}/bank-link/opening-adjustment/record`, async (route) => {
    skippedElsewhere = (await request.post(`${API_BASE_URL}/accounts/${setup.accountId}/bank-link/opening-adjustment/skip`, {
      headers: asUser(setup.user),
    })).status()
    await route.continue()
  }, { times: 1 })

  await offer.record.click()

  await expect(errorToast(page, 'There is no opening balance to confirm')).toBeVisible()
  await expect(offer.sentence).toBeHidden()
  expect(skippedElsewhere).toBe(200)
  expect(await countLedgerTransactions(request, setup.user)).toBe(1)
})

// A read of the link can come back without the offer before an answer to it does, as one the server
// answered once the offer was skipped in another window does. The modal reads the link again as it
// opens, and that read is held until the offer has been skipped, while the answer's refusal is held
// until the offer has gone
test('says why the server refused an answer whose offer a read of the link had already folded away', async ({ page, request }) => {
  const setup = await linkWithGap(request)
  const linkUrl = `${API_BASE_URL}/accounts/${setup.accountId}/bank-link`
  const recordUrl = `${linkUrl}/opening-adjustment/record`
  let skipped = () => {}
  const skippedElsewhere = new Promise<void>((resolve) => { skipped = resolve })
  let answerRefusal = () => {}
  const refusalReleased = new Promise<void>((resolve) => { answerRefusal = resolve })
  let skipStatus = 0
  await page.route(recordUrl, async (route) => {
    skipStatus = (await request.post(`${linkUrl}/opening-adjustment/skip`, { headers: asUser(setup.user) })).status()
    skipped()
    const response = await route.fetch()
    await refusalReleased
    await route.fulfill({ response })
  })
  await logInViaApi(page, setup.user)
  const dialog = await openBankLinkHoldingRead(page, setup.accountId, OPENING_BALANCE_STATUS, skippedElsewhere, WORKER_RESULT_TIMEOUT_MS)

  await dialog.getByRole('button', { name: 'Record adjustment' }).click()
  await expect(offerText(dialog, setup.adjustmentDate)).toHaveCount(0)

  const refused = page.waitForResponse(recordUrl)
  answerRefusal()
  expect((await refused).status()).toBe(409)
  await expect(errorToast(page, 'There is no opening balance to confirm')).toBeVisible()
  expect(skipStatus).toBe(200)
  expect(await countLedgerTransactions(request, setup.user)).toBe(1)
})

// The offer can fold away with the button holding focus before the answer comes back, as a read of the
// link the server answered once the answer had reached it leaves the offer out. The modal reads the link
// again as it opens, and that read is held until Skip has reached the server, while Skip's own answer is
// held until the offer has gone
test('moves focus on from an answer whose offer folds away before it answers', async ({ page, request }) => {
  const setup = await linkWithGap(request)
  const skipUrl = `${API_BASE_URL}/accounts/${setup.accountId}/bank-link/opening-adjustment/skip`
  let skipReached = () => {}
  const reached = new Promise<void>((resolve) => { skipReached = resolve })
  let answerSkip = () => {}
  const answerReleased = new Promise<void>((resolve) => { answerSkip = resolve })
  await page.route(skipUrl, async (route) => {
    const response = await route.fetch()
    skipReached()
    await answerReleased
    await route.fulfill({ response })
  })
  await logInViaApi(page, setup.user)
  const dialog = await openBankLinkHoldingRead(page, setup.accountId, OPENING_BALANCE_STATUS, reached, WORKER_RESULT_TIMEOUT_MS)

  // The modal opens with Sync now focused, after the offer's buttons
  const syncNow = dialog.getByRole('button', { name: 'Sync now' })
  await expect(syncNow).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Skip', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(offerText(dialog, setup.adjustmentDate)).toHaveCount(0)
  await expect(syncNow).toBeFocused()

  const answered = page.waitForResponse(skipUrl)
  answerSkip()
  expect((await answered).status()).toBe(200)
})

// A read of the link can fold the offer away while focus is elsewhere in the modal, as one the server
// answered once the offer was skipped in another window does. The modal reads the link again as it
// opens, and that read is held until the offer has been skipped
test('leaves focus where the person put it when a read of the link folds the offer away', async ({ page, request }) => {
  const setup = await linkWithGap(request)
  let skipped = () => {}
  const skippedElsewhere = new Promise<void>((resolve) => { skipped = resolve })
  await logInViaApi(page, setup.user)
  const dialog = await openBankLinkHoldingRead(page, setup.accountId, OPENING_BALANCE_STATUS, skippedElsewhere, WORKER_RESULT_TIMEOUT_MS)
  await expect(dialog.getByRole('button', { name: 'Sync now' })).toBeFocused()
  const name = dialog.getByLabel('Account name')
  await name.click()

  const skip = await request.post(`${API_BASE_URL}/accounts/${setup.accountId}/bank-link/opening-adjustment/skip`, { headers: asUser(setup.user) })
  expect(skip.status()).toBe(200)
  skipped()
  await expect(offerText(dialog, setup.adjustmentDate)).toHaveCount(0)
  await expect(name).toBeFocused()
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`keeps the offer readable in the ${colorScheme} theme, with no sideways scroll`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const { setup, offer } = await openOffer(page, request)
    if (colorScheme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)

    // The message shows beside the label, so every line of the offer can be read at once
    await offer.amount.fill('')
    await offer.record.click()
    for (const text of [offerText(offer.dialog, setup.adjustmentDate), offer.dialog.getByText('Adjustment amount', { exact: true }), offer.zeroMessage]) {
      await expect(text).toBeVisible()
      expect(await contrastOf(text)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
}
