import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, signUpUser, todayInTestTimezone, type TestUser } from '../support/api'
import { fact, logInViaApi, openPage } from '../support/app'
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
  requireBridgeBankSignIn,
  revokeBridgeAccess,
  waitForConnection,
  WORKER_RESULT_TIMEOUT_MS,
  type BridgeScenario,
  type SeededConnection,
} from '../support/bankSync'
import { API_BASE_URL } from '../support/target'

// A linked account's bank sync status, as its page shows it once the worker has met each situation
// on the fake SimpleFIN Bridge: the identity card's Bank sync fact, the Bank link section's Status,
// and the notice for whatever stops the sync, with the action that resumes it. The dot's blink while
// a sync fetches is watched on a link read answered here instead. Sync details' wording is covered by
// the status unit tests
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
