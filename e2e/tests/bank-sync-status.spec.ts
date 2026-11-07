import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import {
  asUser,
  createAccount,
  createTransaction,
  daysFromTodayInTestTimezone,
  signUpUser,
  todayInTestTimezone,
  type TestUser,
} from '../support/api'
import { fact, logInViaApi, openPage, watchServerRequests } from '../support/app'
import {
  addBridgeBankAccount,
  addBridgeBankLogin,
  breakBridge,
  buildLinkAnswer,
  changeBridgeBankAccountId,
  claimSetupToken,
  createBridgeSetupToken,
  createEmptyBridgeScenario,
  createSampleBridgeScenario,
  linkBankAccount,
  linkToSampleBankAccount,
  openBankLink,
  requireBridgeBankSignIn,
  revokeBridgeAccess,
  waitForConnection,
  type BridgeScenario,
  type SeededConnection,
} from '../support/bankSync'
import { MINUS, readBoxes } from '../support/selectors'
import { AT_EVERY_SIZE } from '../support/sizes'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only, apart from the balance comparison, unavailable balance, retry and rejected
// connection tests. These run at every size: the balances, the notes over them and the notice's action
// take their own layouts at each width. The tests that reopen Sync details set the one size they check

// A linked account's bank sync status, as its page shows it once the worker has met each situation
// on the fake SimpleFIN Bridge: the identity card's Bank sync fact, the Bank link section's Status,
// the notice for whatever stops the sync, with the action that resumes it, and the bank's balance
// beside the ledger's once the link has synced. The dot's blink while a sync fetches, and the time
// since the last sync as the page stays open, are watched on a link read answered here instead. Sync
// details' wording is covered by the status unit tests
const SAMPLE_BANK = 'Harbour Bank'
const SAMPLE_CHEQUING = 'Everyday Chequing'

// What a link reads as once its import is reviewed with a gap between the balances, until the
// opening adjustment offered for it is answered
const OPENING_BALANCE_STATUS = 'Opening balance to confirm'

// How long the page stays open after the link synced, long enough for its label to move past just now
const SYNC_AGE_MS = 5 * 60 * 1000

// The width from which a notice's action sits beside its text rather than under it
const NOTICE_ROW_MIN_WIDTH = 640

/**
 * Whether a status dot blinks: whether the browser is running a fade on it that repeats without end,
 * as the dot's blink does and nothing else on it does
 */
function isBlinkRunning(dot: Element): boolean {
  return dot.getAnimations().some((animation) =>
    animation.playState === 'running' && animation.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY)
}

function isBlinking(dot: Locator): Promise<boolean> {
  return dot.evaluate(isBlinkRunning)
}

/**
 * Answers the account's link as syncing. A real sync would have to be held at the Bridge for as long as
 * the dot is watched, keeping one of the worker's few runners from every other test's imports and syncs
 * meanwhile
 */
async function answerSyncing(page: Page, accountId: string): Promise<void> {
  await page.route(`${API_BASE_URL}/accounts/${accountId}/bank-link`, (route) => route.fulfill({
    json: { account_id: accountId, link: buildLinkAnswer(accountId, { sync_in_progress: true }), previous_link: null },
  }))
}

// How far an app button's focus ring spreads outside it
const FOCUS_RING_PX = 3

/**
 * The boxes in the dialogue that cut off part of an element, or of the room it needs around it for its
 * focus ring, named by their classes
 */
async function readClippingBoxes(element: Locator, room = 0): Promise<string[]> {
  return element.evaluate((target, needed) => {
    const rect = target.getBoundingClientRect()
    const clipping: string[] = []
    for (let box = target.parentElement; box; box = box.parentElement) {
      const style = getComputedStyle(box)
      const bounds = box.getBoundingClientRect()

      // Half a pixel spare, for a layout in fractions of one
      const cutsAcross = style.overflowX !== 'visible' && (rect.left - needed < bounds.left - 0.5 || rect.right + needed > bounds.right + 0.5)
      const cutsDown = style.overflowY !== 'visible' && (rect.top - needed < bounds.top - 0.5 || rect.bottom + needed > bounds.bottom + 0.5)
      if (cutsAcross || cutsDown) clipping.push(`${box.tagName.toLowerCase()}.${box.className}`)

      // The page behind the dialogue doesn't hold it, so nothing past the dialogue cuts it off
      if (box.getAttribute('role') === 'dialog') break
    }
    return clipping
  }, room)
}

/**
 * Whether one element's box covers part of another's, with half a pixel spare for a layout in
 * fractions of one
 */
async function isCovering(cover: Locator, covered: Locator): Promise<boolean> {
  const [over, under] = await Promise.all([cover.boundingBox(), covered.boundingBox()])
  if (!over || !under) return false
  const across = Math.min(over.x + over.width, under.x + under.width) - Math.max(over.x, under.x)
  const down = Math.min(over.y + over.height, under.y + under.height) - Math.max(over.y, under.y)
  return across > 0.5 && down > 0.5
}

/**
 * Whether a note covers any part of the bank's balance, the ledger's or the difference, label or figure
 */
async function coversAnyBalance(dialog: Locator, note: Locator): Promise<boolean> {
  for (const label of ['SimpleFIN', 'Ledger', /^Difference/]) {
    if (await isCovering(note, fact(dialog, label).locator('..'))) return true
  }
  return false
}

/**
 * Links a new account with an empty ledger to the sample chequing account, so the balances differ,
 * and opens its Bank link in a window of the given size. It returns once the modal has focused the
 * section's first action and jumped down to the section, either of which undoes a scroll made earlier
 */
async function openBalancesThatDiffer(page: Page, request: APIRequestContext, size: { width: number; height: number }): Promise<Locator> {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await linkToSampleBankAccount(request, user, { accountId: account.id, bankAccountName: SAMPLE_CHEQUING })

  // The jump is instant without motion, so it has ended once it has started
  await page.setViewportSize(size)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await logInViaApi(page, user)
  const dialog = await openBankLink(page, account.id, OPENING_BALANCE_STATUS)
  const difference = fact(dialog, /^Difference/)
  await expect(difference).toHaveText(`${MINUS}$2,418.36`)
  await expect(dialog.getByRole('button', { name: 'Sync now' })).toBeFocused()
  await expect.poll(() => difference.evaluate((element) => {
    let body = element.parentElement!
    while (getComputedStyle(body).overflowY !== 'auto') body = body.parentElement!
    return body.scrollTop
  })).toBeGreaterThan(0)
  return dialog
}

/**
 * Claims a connection to the sample bank login, puts a fault in place on the Bridge, then links the
 * account to its Everyday Chequing, so the link's first import meets the fault rather than a worker
 * syncing in between
 */
async function linkIntoFault(
  request: APIRequestContext,
  user: TestUser,
  accountId: string,
  fault: (scenarioId: string) => Promise<void>,
): Promise<{ scenario: BridgeScenario; connection: SeededConnection }> {
  const scenario = await createSampleBridgeScenario(request)
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  await fault(scenario.id)
  await linkBankAccount(request, user, {
    accountId,
    connectionId: connection.id,
    externalAccountId: connection.accounts.find((bankAccount) => bankAccount.name === SAMPLE_CHEQUING)!.external_id,
    startDate: todayInTestTimezone(),
  })
  return { scenario, connection }
}

/**
 * Links the account to the sample bank login's Everyday Chequing with the Bridge sending its balances
 * as given, so the link's first sync reads those balances
 */
async function linkWithBalances(
  request: APIRequestContext,
  user: TestUser,
  accountId: string,
  balances: { balance?: string; available_balance?: string },
): Promise<void> {
  await linkToSampleBankAccount(request, user, { accountId, bankAccountName: SAMPLE_CHEQUING, balances })
}

// A read answered here can still be on its way to the page when a test ends, and would otherwise
// surface as an error outside any test
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('reads as synced once the import finishes', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })

  // The bank's balance matches the empty ledger, so there is no opening balance to confirm
  await linkWithBalances(request, user, account.id, { balance: '0.00' })

  await logInViaApi(page, user)
  const dialog = await openBankLink(page, account.id, /Synced (just now|\d+ minutes? ago)\./)
  await expect(fact(dialog, 'Status')).toHaveText(/^Synced/)
  await expect(fact(dialog, /^Difference/)).toHaveText('None')
  await expect(dialog.getByRole('button', { name: 'Record adjustment' })).toHaveCount(0)

  // Nothing stops the sync, so no notice offers an action ahead of the link's own
  await expect(dialog.getByRole('button', { name: 'Open settings' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Choose bank account' })).toHaveCount(0)
})

test('compares the bank balance with the ledger at the end of its balance date', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -5000, date: daysFromTodayInTestTimezone(-1) })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -8000, date: daysFromTodayInTestTimezone(1) })
  await linkToSampleBankAccount(request, user, { accountId: account.id, bankAccountName: SAMPLE_CHEQUING })

  // SimpleFIN gives the balance as of now, so the ledger keeps yesterday's transaction and leaves out
  // tomorrow's, and so does the opening adjustment offered for the gap
  await logInViaApi(page, user)
  const dialog = await openBankLink(page, account.id, OPENING_BALANCE_STATUS)
  await expect(fact(dialog, 'SimpleFIN')).toHaveText('$2,418.36')
  await expect(fact(dialog, 'Ledger')).toHaveText('($50.00)')
  await expect(fact(dialog, /^Difference/)).toHaveText(`${MINUS}$2,468.36`)
  await expect(dialog.getByRole('textbox', { name: 'Adjustment amount' })).toHaveValue('2468.36')
  const caption = dialog.getByText(/^As of /)
  await expect(caption).toBeVisible()
  await expect(caption).not.toContainText('available')

  // Balances of a common size share a row in equal columns from the width a notice's action moves
  // beside its text, and take a row each on a phone
  const figures = await readBoxes(page, ['SimpleFIN', 'Ledger', /^Difference/].map((label) => fact(dialog, label)))
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values)
  if (page.viewportSize()!.width >= NOTICE_ROW_MIN_WIDTH) {
    expect(spread(figures.map(({ y }) => y))).toBeLessThan(0.5)
    expect(spread(figures.map(({ width }) => width))).toBeLessThan(0.5)
  } else {
    expect(spread(figures.map(({ x, width }) => x + width))).toBeLessThan(0.5)
    expect(figures.slice(1).every(({ y }, index) => y >= figures[index].y + figures[index].height)).toBe(true)
  }

  // The reason for the gap opens as the keyboard reaches its button, as it does on hover, clear of the
  // balances it explains, labels included, even where each takes a row, and shows whole, reaching past
  // the panel where it needs the room
  const why = dialog.getByRole('button', { name: 'Why the balances differ' })
  await why.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(why).toBeFocused()
  const reason = dialog.locator('.app-tooltip-panel').filter({ hasText: 'Most gaps come from' })
  await expect(reason.locator('..')).toHaveCSS('opacity', '1')
  await expect.poll(() => coversAnyBalance(dialog, reason)).toBe(false)
  await expect.poll(() => readClippingBoxes(reason)).toEqual([])
})

test('shows a bank balance that can\'t be read exactly as unavailable, its reason opening clear of it', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await linkWithBalances(request, user, account.id, { balance: '2418.365' })

  await logInViaApi(page, user)
  const dialog = await openBankLink(page, account.id, /Synced (just now|\d+ minutes? ago)\./)
  const bankBalance = fact(dialog, /^SimpleFIN/)
  await expect(bankBalance).toHaveText('Unavailable')
  await dialog.getByRole('button', { name: 'Why the balance is unavailable' }).click()
  const reason = dialog.locator('.app-tooltip-panel').filter({ hasText: 'can\'t be read exactly' })
  await expect(reason.locator('..')).toHaveCSS('opacity', '1')
  expect(await isCovering(reason, bankBalance)).toBe(false)
})

test('opens the reason for a gap below the difference where the dialog leaves no room above it', async ({ page, request }) => {
  // A short window, where each balance's value sits under its label and the dialogue's body scrolls
  const dialog = await openBalancesThatDiffer(page, request, { width: 1280, height: 480 })
  const difference = fact(dialog, /^Difference/)

  // Scrolled until the difference is at the top of the dialogue's body
  await difference.evaluate((element) => element.parentElement!.scrollIntoView({ block: 'start', behavior: 'instant' }))
  await dialog.getByRole('button', { name: 'Why the balances differ' }).click()
  const reason = dialog.locator('.app-tooltip-panel').filter({ hasText: 'Most gaps come from' })
  await expect(reason.locator('..')).toHaveCSS('opacity', '1')
  expect(await isCovering(reason, difference)).toBe(false)
  await expect.poll(() => readClippingBoxes(reason)).toEqual([])

  // Below the value, since above the balance it would run off the top of the dialogue's body
  const [opened, explained] = await readBoxes(page, [reason, difference])
  expect(opened.y).toBeGreaterThanOrEqual(explained.y + explained.height)
})

// Shown by a press or by the keyboard reaching its icon, the reason moves alike
for (const { shown, show } of [
  { shown: 'opened with a press', show: (icon: Locator) => icon.click() },
  {
    shown: 'shown on keyboard focus',
    show: async (icon: Locator) => {
      await icon.page().keyboard.press('Shift')
      await icon.focus()
    },
  },
]) {
  test(`moves the reason for a gap below the balances as the dialog body scrolls them to its top, ${shown}`, async ({ page, request }) => {
    // A small phone, where each balance takes a row. The reason shows above the three while they have
    // room above them
    const dialog = await openBalancesThatDiffer(page, request, { width: 390, height: 667 })
    await show(dialog.getByRole('button', { name: 'Why the balances differ' }))
    const reason = dialog.locator('.app-tooltip-panel').filter({ hasText: 'Most gaps come from' })
    await expect(reason.locator('..')).toHaveCSS('opacity', '1')
    const [opened, bankBalance] = await readBoxes(page, [reason, fact(dialog, 'SimpleFIN').locator('..')])
    expect(opened.y + opened.height).toBeLessThanOrEqual(bankBalance.y)

    // Scrolled with the reason showing until the difference is at the top of the dialogue's body. That
    // leaves the reason no room above the balances
    await fact(dialog, /^Difference/).evaluate((element) => element.parentElement!.scrollIntoView({ block: 'start', behavior: 'instant' }))
    await expect.poll(() => readClippingBoxes(reason)).toEqual([])
    expect(await coversAnyBalance(dialog, reason)).toBe(false)
  })
}

// A link whose last sync failed: the time's own period ends the sentence in the fact's name, with no
// second one after it
const RETRYING_STATUS = /Retrying at (\w{3} \d{1,2}, )?\d{1,2}:\d{2}\s[ap]\.m\./

/**
 * Scrolls the fact to the foot of the dialogue's body and returns once the scroll has gone out to the
 * page's listeners, and a message sent after them has come back, so a render React queued from one, in
 * a message of its own, has run first. Where the fact already sits at the foot, as on a screen tall
 * enough for the whole modal, nothing scrolls and there's nothing to wait for
 */
async function scrollToFoot(status: Locator): Promise<void> {
  await status.evaluate((element) => new Promise<void>((resolve) => {
    const onScroll = () => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => resolve()
      channel.port2.postMessage(null)
    }
    document.addEventListener('scroll', onScroll, { capture: true, once: true })
    const before = element.getBoundingClientRect().top
    element.scrollIntoView({ block: 'end' })
    if (element.getBoundingClientRect().top === before) {
      document.removeEventListener('scroll', onScroll, { capture: true })
      resolve()
    }
  }))
}

/** How far below its icon a panel's top sits, or above it when negative */
async function readOffsetFromIcon(page: Page, panel: Locator, icon: Locator): Promise<number> {
  const [opened, trigger] = await readBoxes(page, [panel, icon])
  return opened.y - trigger.y
}

// A screen on which the status at the foot of the modal leaves Sync details no room below it, the size
// of the tablet project's. Tests that need a screen this short set the size themselves
const FOOT_LEAVES_NO_ROOM_BELOW = { width: 1194, height: 834 }

/**
 * Links a new account into a failed sync and opens its Bank link, returning the dialogue with the Sync
 * details icon and panel in it
 */
async function openRetryingLink(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await linkIntoFault(request, user, account.id, (scenarioId) => breakBridge(request, scenarioId))
  await logInViaApi(page, user)
  const dialog = await openBankLink(page, account.id, RETRYING_STATUS)
  const details = dialog.locator('.app-tooltip-panel').filter({ hasText: 'Not synced yet' })
  await expect(details).toContainText('Last attempt failed: ')
  return { dialog, showDetails: dialog.getByRole('button', { name: 'Sync details' }), details }
}

/**
 * Scrolls the status to the foot of the modal with the details showing beside it. They explain nothing
 * marked around them, so they stay where they showed, and there the modal's body cuts them off
 *
 * @returns How far below the icon their top sits, where they have stayed
 */
async function scrollShownDetailsToFoot(page: Page, dialog: Locator, showDetails: Locator, details: Locator): Promise<number> {
  const shownAt = await readOffsetFromIcon(page, details, showDetails)
  await scrollToFoot(fact(dialog, 'Status'))
  expect(await readOffsetFromIcon(page, details, showDetails)).toBeCloseTo(shownAt, 0)
  expect(await readClippingBoxes(details)).not.toEqual([])
  return shownAt
}

test('reads as retrying at the time of the retry when the Bridge fails', AT_EVERY_SIZE, async ({ page, request }) => {
  const { dialog, showDetails, details } = await openRetryingLink(page, request)
  await expect(fact(dialog, 'Status')).toHaveText(/^Retrying at /)

  // The details show whole, reaching past the section where they need the room, and so does the ring
  // around Unlink, the section's last control
  await showDetails.click()
  await expect.poll(() => readClippingBoxes(details)).toEqual([])
  expect(await readClippingBoxes(dialog.getByRole('button', { name: 'Unlink', exact: true }), FOCUS_RING_PX)).toEqual([])
})

test('opens Sync details again clear of the foot of the modal after closing them under the pointer', async ({ page, request }) => {
  await page.setViewportSize(FOOT_LEAVES_NO_ROOM_BELOW)
  const { dialog, showDetails, details } = await openRetryingLink(page, request)
  await showDetails.click()
  const openedAt = await scrollShownDetailsToFoot(page, dialog, showDetails, details)

  // Closed under the pointer they stay where they were, shown where the screen has hover and invisible
  // where it hasn't, and opened again without the pointer moving they pick their side afresh, above
  await showDetails.click()
  expect(await readOffsetFromIcon(page, details, showDetails)).toBeCloseTo(openedAt, 0)
  await showDetails.click()
  await expect.poll(() => readClippingBoxes(details)).toEqual([])
})

test('opens Sync details clear of the foot of the modal from the keyboard', async ({ page, request }) => {
  await page.setViewportSize(FOOT_LEAVES_NO_ROOM_BELOW)
  const { dialog, showDetails, details } = await openRetryingLink(page, request)

  // Focus arriving from the keyboard shows them beside the icon, the pointer being kept off it
  await page.mouse.move(0, 0)
  await showDetails.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(showDetails).toBeFocused()
  await expect(details.locator('..')).toHaveCSS('opacity', '1')
  await scrollShownDetailsToFoot(page, dialog, showDetails, details)

  // Focus keeps them showing where they were, and a press on the icon opens them there afresh
  await page.keyboard.press('Enter')
  await expect.poll(() => readClippingBoxes(details)).toEqual([])
})

test('blinks the status dot while a sync fetches, in the modal as on the card', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await answerSyncing(page, account.id)

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const bankSync = page.getByRole('button', { name: 'Bank sync: Syncing. Open bank link' })
  await expect.poll(() => isBlinking(bankSync.getByTestId('sync-status-dot'))).toBe(true)

  // The modal opens with the link already read. Its first view mustn't hold still
  await bankSync.click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await expect.poll(() => isBlinking(fact(dialog, 'Status').getByTestId('sync-status-dot'))).toBe(true)
})

// A dot starts or stops its blink once it has rendered, in work React finishes before it renders
// anything after it, and a blink starts by the frame after. So each dot is checked once a later press
// has rendered, the card's once the modal has opened and the modal's once Sync details has, a press
// landing only once the page has drawn twice without moving
test('holds the status dot still while a sync fetches for anyone who asks for reduced motion, in the modal as on the card', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await answerSyncing(page, account.id)

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const bankSync = page.getByRole('button', { name: 'Bank sync: Syncing. Open bank link' })

  // Held on to, since the open modal takes the card out of what the page offers to assistive technology
  const cardDot = (await bankSync.getByTestId('sync-status-dot').elementHandle())!
  await bankSync.click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await expect(dialog).toBeVisible()
  expect(await cardDot.evaluate(isBlinkRunning)).toBe(false)

  const showDetails = dialog.getByRole('button', { name: 'Sync details' })
  await showDetails.click()
  await expect(showDetails).toHaveAttribute('aria-expanded', 'true')
  expect(await isBlinking(fact(dialog, 'Status').getByTestId('sync-status-dot'))).toBe(false)
})

// Answered here, synced as the page's clock starts, since a real sync can't be timed to it
test('words how long ago the link synced anew as minutes pass with the page open', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const syncedAt = new Date()
  await page.route(`${API_BASE_URL}/accounts/${account.id}/bank-link`, (route) => route.fulfill({
    json: { account_id: account.id, link: buildLinkAnswer(account.id, { last_success_at: syncedAt.toISOString() }), previous_link: null },
  }))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install({ time: syncedAt })
  await logInViaApi(page, user)
  const allLanded = watchServerRequests(page)
  await openPage(page, `/accounts/${account.id}`)
  await expect(page.getByRole('button', { name: 'Bank sync: Synced just now. Open bank link' })).toBeVisible()

  await allLanded()
  await page.clock.runFor(SYNC_AGE_MS)
  await expect(page.getByRole('button', { name: 'Bank sync: Synced 5 minutes ago. Open bank link' })).toBeVisible()
})

test('stops on a rejected connection, with a notice that leads to Settings to reconnect it', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const { connection } = await linkIntoFault(request, user, account.id, (scenarioId) => revokeBridgeAccess(request, scenarioId))
  await waitForConnection(request, user, connection.id, (current) => current.status === 'credential_rejected')

  await logInViaApi(page, user)
  const dialog = await openBankLink(page, account.id, 'Reconnect needed')
  // The notice's full wording is the Bank link section's unit tests' to hold
  const notice = dialog.getByText(/^SimpleFIN Bridge rejected the connection this account uses\./)
  const openSettings = dialog.getByRole('button', { name: 'Open settings' })
  await expect(notice).toBeVisible()

  // The notice's action is what resumes the sync, so the modal opens on it rather than on Review settings
  await expect(openSettings).toBeFocused()

  // Beside the text from 640px, and on its own row under it on a phone
  const [noticeBox, actionBox] = await Promise.all([notice.boundingBox(), openSettings.boundingBox()])
  if (page.viewportSize()!.width >= NOTICE_ROW_MIN_WIDTH) {
    expect(actionBox!.x).toBeGreaterThanOrEqual(noticeBox!.x + noticeBox!.width)
  } else {
    expect(actionBox!.y).toBeGreaterThanOrEqual(noticeBox!.y + noticeBox!.height)
  }

  await openSettings.click()
  await expect(page).toHaveURL(/\/settings#bank-connections$/)
})

test('stops on a bank asking for its sign-in, saying where to sign in again', async ({ page, request }) => {
  const user = await signUpUser(request)
  const [account, scenario] = await Promise.all([createAccount(request, user, { name: 'Everyday' }), createEmptyBridgeScenario(request)])
  const login = await addBridgeBankLogin(request, scenario.id, SAMPLE_BANK)
  await addBridgeBankAccount(request, scenario.id, { connId: login, name: SAMPLE_CHEQUING, currency: 'CAD' })
  const connection = await claimSetupToken(request, user, scenario.setupToken)

  // The import the link queues meets the bank login's problem
  await requireBridgeBankSignIn(request, scenario.id, login)
  await linkBankAccount(request, user, {
    accountId: account.id,
    connectionId: connection.id,
    externalAccountId: connection.accounts[0].external_id,
    startDate: todayInTestTimezone(),
  })
  await waitForConnection(request, user, connection.id, (current) => current.accounts.some((bankAccount) => bankAccount.signin_needed))

  await logInViaApi(page, user)
  const dialog = await openBankLink(page, account.id, 'Bank sign-in needed')
  await expect(dialog.getByText('Sign in to your bank again in SimpleFIN Bridge.', { exact: true })).toBeVisible()
})

test('asks for the bank account again once SimpleFIN lists it differently, opening the choice from the notice', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const { scenario, connection } = await linkIntoFault(request, user, account.id, (scenarioId) => revokeBridgeAccess(request, scenarioId))
  await waitForConnection(request, user, connection.id, (current) => current.status === 'credential_rejected')

  // SimpleFIN lists the bank account differently once reconnected, so the link waits for it to be chosen again
  const chequing = connection.accounts.find((bankAccount) => bankAccount.name === SAMPLE_CHEQUING)!
  await changeBridgeBankAccountId(request, scenario.id, chequing.external_id, `${chequing.external_id}-relisted`)
  const reconnected = await request.post(`${API_BASE_URL}/bank-sync/connections/${connection.id}/reconnect`, {
    headers: asUser(user),
    data: { credentials: { setup_token: await createBridgeSetupToken(request, scenario.id) } },
  })
  expect(reconnected.ok()).toBe(true)

  await logInViaApi(page, user)
  const dialog = await openBankLink(page, account.id, 'Choose bank account')
  await expect(dialog.getByText(/^SimpleFIN now lists Everyday Chequing differently/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Choose bank account', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Choose bank account again' })).toBeVisible()
})
