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
import { fact, logInViaApi, openPage } from '../support/app'
import {
  addBridgeBankAccount,
  addBridgeBankLogin,
  breakBridge,
  buildLinkAnswer,
  changeBridgeBalances,
  changeBridgeBankAccountId,
  claimSetupToken,
  createBridgeSetupToken,
  createEmptyBridgeScenario,
  createSampleBridgeScenario,
  linkBankAccount,
  linkToSampleBankAccount,
  requireBridgeBankSignIn,
  revokeBridgeAccess,
  waitForConnection,
  WORKER_RESULT_TIMEOUT_MS,
  type BridgeScenario,
  type SeededConnection,
} from '../support/bankSync'
import { MINUS } from '../support/selectors'
import { API_BASE_URL } from '../support/target'

// A linked account's bank sync status, as its page shows it once the worker has met each situation
// on the fake SimpleFIN Bridge: the identity card's Bank sync fact, the Bank link section's Status,
// the notice for whatever stops the sync, with the action that resumes it, and the bank's balance
// beside the ledger's once the link has synced. The dot's blink while a sync fetches is watched on a
// link read answered here instead. Sync details' wording is covered by the status unit tests
const SAMPLE_BANK = 'Harbour Bank'
const SAMPLE_CHEQUING = 'Everyday Chequing'

// The width from which a notice's action sits beside its text rather than under it
const NOTICE_ROW_MIN_WIDTH = 640

// Fainter than a dot ever is at rest, and well short of how faint a blink goes
const BLINKING_OPACITY = 0.5

// Three blinks of 1.4 seconds, read at least as often as one blink has frames, so a dot that blinks
// is met at its faintest however slowly a busy browser draws its frames
const BLINK_WATCH_MS = 4_200
const BLINK_WATCH_READS = 90

/**
 * Whether a status dot blinks: read every frame until it shows fainter than it ever is at rest, or
 * for three blinks and at least as many reads as one blink has frames without doing so
 */
async function isBlinking(dot: Locator): Promise<boolean> {
  return dot.evaluate((element, { faint, watchMs, reads }) => new Promise<boolean>((resolve) => {
    const end = performance.now() + watchMs
    let count = 0
    const read = () => {
      count += 1
      // Parsed rather than converted, so a dot taken off the page, which has no opacity, never reads as faint
      if (Number.parseFloat(getComputedStyle(element).opacity) < faint) resolve(true)
      else if (performance.now() >= end && count >= reads) resolve(false)
      else requestAnimationFrame(read)
    }
    read()
  }), { faint: BLINKING_OPACITY, watchMs: BLINK_WATCH_MS, reads: BLINK_WATCH_READS })
}

// How far an app button's focus ring spreads outside it
const FOCUS_RING_PX = 3

/**
 * The boxes in the dialog that cut off part of an element, or of the room it needs around it for its
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

      // The page behind the dialog doesn't hold it, so nothing past the dialog cuts it off
      if (box.getAttribute('role') === 'dialog') break
    }
    return clipping
  }, room)
}

/**
 * Whether an element's text runs past its box, so part of it is cut off or hidden behind an ellipsis
 */
async function isCutShort(element: Locator): Promise<boolean> {
  return element.evaluate((target) => target.scrollWidth > target.clientWidth)
}

/**
 * An element's text a line at a time as the browser lays it out, without its spaces or the text of a
 * tooltip in it, which sits apart from its lines. A glyph lower than the middle of the one before it
 * starts a line
 */
async function readLines(element: Locator): Promise<string[]> {
  return element.evaluate((target) => {
    const lines: { text: string; top: number; height: number }[] = []
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement?.closest('.app-tooltip-panel') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    })
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? ''
      for (let index = 0; index < text.length; index += 1) {
        if (!text[index].trim()) continue
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + 1)
        const { top, height } = range.getBoundingClientRect()
        const line = lines[lines.length - 1]
        if (line && top < line.top + line.height / 2) line.text += text[index]
        else lines.push({ text: text[index], top, height })
      }
    }
    return lines.map(({ text }) => text)
  })
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
 * Opens the account's page and, once the identity card's Bank sync fact reads as expected, its edit
 * modal at the Bank link section through that fact
 *
 * @param status - The label the fact should come to show, which may take the worker a while. A
 * pattern ends with the period that ends the label's sentence in the fact's name, since a label
 * ending in p.m. has one already
 */
async function openBankLink(page: Page, user: TestUser, accountId: string, status: string | RegExp): Promise<Locator> {
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${accountId}`)
  const name = typeof status === 'string' ? `Bank sync: ${status}. Open bank link` : new RegExp(`^Bank sync: ${status.source} Open bank link$`)
  const bankSync = page.getByRole('button', { name })
  await expect(bankSync).toBeVisible({ timeout: WORKER_RESULT_TIMEOUT_MS })
  await bankSync.click()
  const dialog = page.getByRole('dialog', { name: 'Edit Account', exact: true })
  await expect(dialog).toBeVisible()
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
 * Claims a connection to the sample bank login, has the Bridge send Everyday Chequing's balances as
 * given, then links the account to it, so the link's first sync reads those balances
 */
async function linkWithBalances(
  request: APIRequestContext,
  user: TestUser,
  accountId: string,
  balances: { balance?: string; available_balance?: string },
): Promise<void> {
  const scenario = await createSampleBridgeScenario(request)
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  const chequingId = connection.accounts.find((bankAccount) => bankAccount.name === SAMPLE_CHEQUING)!.external_id
  await changeBridgeBalances(request, scenario.id, chequingId, balances)
  await linkBankAccount(request, user, { accountId, connectionId: connection.id, externalAccountId: chequingId, startDate: todayInTestTimezone() })
}

// A read answered here can still be on its way to the page when a test ends, which would otherwise
// surface as an error outside any test
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('reads as synced once the import finishes', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await linkToSampleBankAccount(request, user, { accountId: account.id, bankAccountName: SAMPLE_CHEQUING })

  const dialog = await openBankLink(page, user, account.id, /Synced (just now|\d+ minutes? ago)\./)
  await expect(fact(dialog, 'Status')).toHaveText(/^Synced/)

  // Nothing stops the sync, so no notice offers an action ahead of Unlink
  await expect(dialog.getByRole('button', { name: 'Open settings' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Choose bank account' })).toHaveCount(0)
})

test('compares the bank balance with the ledger at the end of its balance date', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -5000, date: daysFromTodayInTestTimezone(-1) })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -8000, date: daysFromTodayInTestTimezone(1) })
  await linkToSampleBankAccount(request, user, { accountId: account.id, bankAccountName: SAMPLE_CHEQUING })

  // SimpleFIN gives the balance as of now, so the ledger keeps yesterday's transaction and leaves out
  // tomorrow's
  const dialog = await openBankLink(page, user, account.id, /Synced (just now|\d+ minutes? ago)\./)
  await expect(fact(dialog, 'SimpleFIN')).toHaveText('$2,418.36')
  await expect(fact(dialog, 'Ledger')).toHaveText('($50.00)')
  await expect(fact(dialog, /^Difference/)).toHaveText(`${MINUS}$2,468.36`)
  const caption = dialog.getByText(/^As of /)
  await expect(caption).toBeVisible()
  await expect(caption).not.toContainText('available')

  // Balances of a common size share a row in equal columns from the width a notice's action moves
  // beside its text, and take a row each on a phone
  const figures = await Promise.all(['SimpleFIN', 'Ledger', /^Difference/].map(async (label) => (await fact(dialog, label).boundingBox())!))
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values)
  if (page.viewportSize()!.width >= NOTICE_ROW_MIN_WIDTH) {
    expect(spread(figures.map(({ y }) => y))).toBeLessThan(0.5)
    expect(spread(figures.map(({ width }) => width))).toBeLessThan(0.5)
  } else {
    expect(spread(figures.map(({ x, width }) => x + width))).toBeLessThan(0.5)
    expect(figures.slice(1).every(({ y }, index) => y >= figures[index].y + figures[index].height)).toBe(true)
  }

  // The reason for the gap opens as the keyboard reaches its button, as it does on hover, clear of the
  // balance it explains, and shows whole, reaching past the panel where it needs the room
  const why = dialog.getByRole('button', { name: 'Why the balances differ' })
  await why.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(why).toBeFocused()
  const reason = dialog.locator('.app-tooltip-panel').filter({ hasText: 'Most gaps come from' })
  await expect(reason.locator('..')).toHaveCSS('opacity', '1')
  expect(await isCovering(reason, fact(dialog, /^Difference/))).toBe(false)
  await expect.poll(() => readClippingBoxes(reason)).toEqual([])
})

test('shows a bank balance that can\'t be read exactly as unavailable, its reason opening clear of it', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await linkWithBalances(request, user, account.id, { balance: '2418.365' })

  const dialog = await openBankLink(page, user, account.id, /Synced (just now|\d+ minutes? ago)\./)
  const bankBalance = fact(dialog, /^SimpleFIN/)
  await expect(bankBalance).toHaveText('Unavailable')
  await dialog.getByRole('button', { name: 'Why the balance is unavailable' }).click()
  const reason = dialog.locator('.app-tooltip-panel').filter({ hasText: 'can\'t be read exactly' })
  await expect(reason.locator('..')).toHaveCSS('opacity', '1')
  expect(await isCovering(reason, bankBalance)).toBe(false)
})

test('keeps each balance whole with its sign, and the caption\'s dot with the part it introduces', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -11111111111100, date: daysFromTodayInTestTimezone(-1) })
  await linkWithBalances(request, user, account.id, { balance: '123456789012.34', available_balance: '111111111111.00' })

  // Twelve digits leave three balances too wide to sit side by side, so they move to another row
  // rather than splitting a figure or leaving its sign on a line of its own, and on a phone the
  // caption wraps without ending a line on the dot before the available balance
  const dialog = await openBankLink(page, user, account.id, /Synced (just now|\d+ minutes? ago)\./)
  const figures: [Locator, string][] = [
    [fact(dialog, 'SimpleFIN'), '$123,456,789,012.34'],
    [fact(dialog, 'Ledger'), '($111,111,111,111.00)'],
    [fact(dialog, /^Difference/), `${MINUS}$234,567,900,123.34`],
  ]
  for (const [figure, text] of figures) {
    await expect(figure).toHaveText(text)
    expect(await readLines(figure)).toEqual([text])
    expect(await isCutShort(figure)).toBe(false)
  }
  const caption = dialog.getByText(/^As of /)
  await expect(caption).toContainText('$111,111,111,111.00 available')
  expect((await readLines(caption)).filter((line) => line.endsWith('·'))).toEqual([])
})

test('marks an available balance that can\'t be read exactly in the caption, keeping the dot with it', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await linkWithBalances(request, user, account.id, { available_balance: '2318.365' })

  // On a phone the caption wraps, and the dot goes to the next line with the part it introduces
  const dialog = await openBankLink(page, user, account.id, /Synced (just now|\d+ minutes? ago)\./)
  const caption = dialog.getByText(/^As of /)
  await expect(caption).toContainText('Available balance unavailable')
  expect((await readLines(caption)).filter((line) => line.endsWith('·'))).toEqual([])
})

test('reads as retrying at the time of the retry when the Bridge fails', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await linkIntoFault(request, user, account.id, (scenarioId) => breakBridge(request, scenarioId))

  // The time's own period ends the sentence in the fact's name, with no second one after it
  const dialog = await openBankLink(page, user, account.id, /Retrying at (\w{3} \d{1,2}, )?\d{1,2}:\d{2}\s[ap]\.m\./)
  await expect(fact(dialog, 'Status')).toHaveText(/^Retrying at /)

  // The details show whole, reaching past the section where they need the room, and so does the ring
  // around Unlink, the section's last control
  const showDetails = dialog.getByRole('button', { name: 'Sync details' })
  const details = dialog.locator('.app-tooltip-panel').filter({ hasText: 'Not synced yet' })
  await showDetails.click()
  await expect(details).toContainText('Last attempt failed: ')
  await expect.poll(() => readClippingBoxes(details)).toEqual([])
  expect(await readClippingBoxes(dialog.getByRole('button', { name: 'Unlink', exact: true }), FOCUS_RING_PX)).toEqual([])

  // With the status scrolled to the foot of the modal, where they'd fall out of sight, they open above it
  await showDetails.click()
  await fact(dialog, 'Status').evaluate((status) => status.scrollIntoView({ block: 'end' }))
  await showDetails.click()
  await expect.poll(() => readClippingBoxes(details)).toEqual([])
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`blinks the status dot while a sync fetches, in the modal as on the card, with ${reducedMotion} motion`, async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion })
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday' })

    // Answered here, since a real sync finishes before the dot could be watched
    await page.route(`${API_BASE_URL}/accounts/${account.id}/bank-link`, (route) => route.fulfill({
      json: { account_id: account.id, link: buildLinkAnswer(account.id, { sync_in_progress: true }), previous_link: null },
    }))
    const blinks = reducedMotion === 'no-preference'

    await logInViaApi(page, user)
    await openPage(page, `/accounts/${account.id}`)
    const bankSync = page.getByRole('button', { name: 'Bank sync: Syncing. Open bank link' })
    expect(await isBlinking(bankSync.getByTestId('sync-status-dot'))).toBe(blinks)

    // The modal opens with the link already read, which its first view mustn't hold still
    await bankSync.click()
    const dialog = page.getByRole('dialog', { name: 'Edit Account', exact: true })
    expect(await isBlinking(fact(dialog, 'Status').getByTestId('sync-status-dot'))).toBe(blinks)
  })
}

test('stops on a rejected connection, with a notice that leads to Settings to reconnect it', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const { connection } = await linkIntoFault(request, user, account.id, (scenarioId) => revokeBridgeAccess(request, scenarioId))
  await waitForConnection(request, user, connection.id, (current) => current.status === 'credential_rejected')

  const dialog = await openBankLink(page, user, account.id, 'Reconnect needed')
  const notice = dialog.getByText(
    'SimpleFIN Bridge rejected the connection this account uses. Automatic sync is stopped for every account on it until you reconnect it in Settings with a new setup token.',
  )
  const openSettings = dialog.getByRole('button', { name: 'Open settings' })
  await expect(notice).toBeVisible()

  // The notice's action is what resumes the sync, so the modal opens on it rather than on Unlink
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

  const dialog = await openBankLink(page, user, account.id, 'Bank sign-in needed')
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
    data: { setup_token: await createBridgeSetupToken(request, scenario.id) },
  })
  expect(reconnected.ok()).toBe(true)

  const dialog = await openBankLink(page, user, account.id, 'Choose bank account')
  await expect(dialog.getByText(
    "SimpleFIN now lists Everyday Chequing differently, so Lumina Finance can't tell whether it's the same account. Choose its bank account again to resume syncing.",
  )).toBeVisible()
  await dialog.getByRole('button', { name: 'Choose bank account', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Choose bank account again' })).toBeVisible()
})
