import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createGroup, createInstitution, formatDateLabel, formatToday, signUpUser, todayInTestTimezone } from '../support/api'
import { chooseFromDropdown, fact, logInViaApi, openModal, openPage, typeDate } from '../support/app'
import {
  addBridgeBankAccount,
  addBridgeBankLogin,
  bankSyncFact,
  buildLinkAnswer,
  changeProviders,
  claimSetupToken,
  clearBridgeFault,
  readConnection,
  createEmptyBridgeScenario,
  createSampleBridgeScenario,
  linkBankAccount,
  linkToSampleBankAccount,
  openBankLink,
  READ_LINK_STATUS,
  runClockUntil,
  stallBridge,
  stopClock,
  WORKER_RESULT_TIMEOUT_MS,
  type SeededConnection,
} from '../support/bankSync'
import { isUncovered, MESSAGE_IN_CORNER, readMessageInset } from '../support/selectors'
import { AT_EVERY_SIZE_NEEDS_BANK_SYNC, NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only, apart from the test linking an account from its page. That one runs at every size
// since the linked view is taller than the one it replaces, so on a phone it could push the action it focuses
// out of view. The rest set the window sizes they check themselves

// An account links to a bank account from its own page, through the Bank link section of its edit
// modal (the identity card's Bank sync fact opens it) and straight after it is created. Connections
// are claimed from the fake SimpleFIN Bridge the instance syncs with, and links are made and ended on
// the server. Only whether the deployment's worker is running is answered here instead
const SAMPLE_BANK = 'Harbour Bank'
const SAMPLE_CHEQUING = 'Everyday Chequing'
const SAMPLE_VISA = 'Rewards Visa'
const NOT_SET_UP = "Bank sync isn't set up on this server yet."
const BANK_CONNECTIONS_LINK = 'Open bank connections'
const BANK_CONNECTIONS_PATH = '/settings#bank-connections'
const ARCHIVED = 'Archived accounts are read-only'

// How far the page's clock moves at a time while the import test waits on what takes seconds of it,
// such as the link's next read, with motion reduced so that nothing is read frame by frame
const IMPORT_CLOCK_STEP_MS = 100

// Well past when a Bank link section that loads after its modal has opened moves focus to its action
const OPENING_FOCUS_PASSED_MS = 1_000

// Three frames on the page's clock, by when the frame after a fade has ended has passed
const FRAMES_PAST_FADE_MS = 48

// How far the page's clock moves at a time while a test waits for the app shell's next read of the
// links. That read comes every 2 seconds while a link imports
const LINK_READ_CLOCK_STEP_MS = 100

// What the Bank link section says while the import waits for more links, for SimpleFIN
const IMPORT_REMINDER =
  'Syncing starts shortly. Please link your other accounts now to import them together.'

// Either side of where a modal stops filling the screen and sits in the middle of it, at a laptop's height
const WIDEST_FULL_SCREEN_MODAL_SIZE = { width: 1049, height: 800 }
const NARROWEST_CENTRED_MODAL_SIZE = { width: 1050, height: 800 }

/**
 * The first day of the month a number of months before this one, as YYYY-MM-DD
 */
function firstOfMonthsAgo(months: number): string {
  const [year, month] = todayInTestTimezone().split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 - months, 1)).toISOString().slice(0, 10)
}

function externalIdOf(connection: SeededConnection, name: string): string {
  return connection.accounts.find((bankAccount) => bankAccount.name === name)!.external_id
}

function toast(page: Page, text: string): Locator {
  return page.getByRole('status').filter({ hasText: text })
}

/**
 * The tooltip carrying a disabled control's reason. It sits on the page rather than beside the
 * control and fades rather than leaving
 */
function shownReason(page: Page, reason: string): Locator {
  return page.getByTestId('disabled-reason-tooltip').filter({ hasText: reason })
}

/**
 * Collects the bank account listings the page asks for. Each names the account it is for
 */
function watchListings(page: Page): string[] {
  const listings: string[] = []
  page.on('request', (sent) => {
    if (sent.url().includes('for_account_id=')) listings.push(sent.url())
  })
  return listings
}

/**
 * Chooses the first start on offer, whichever the account's ledger leaves
 */
async function chooseFirstStart(flow: Locator): Promise<void> {
  await flow.getByRole('radiogroup', { name: 'Start' }).getByRole('radio').first().click()
}

/**
 * Links Everyday to the sample chequing account from its edit modal. The modal stays open behind the
 * message confirming the link once the link flow closes. The page's clock stops as the link is made and,
 * once the server has answered it, moves on only until the flow has gone and the message has come in, so
 * the message stays up however long a busy machine takes over the checks on it. Modals still come and go
 * on the clock as it moves
 */
async function linkFromEditAccount(page: Page, request: APIRequestContext): Promise<{ dialog: Locator; message: Locator }> {
  const user = await signUpUser(request)
  const [everyday, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createSampleBridgeScenario(request),
  ])
  await claimSetupToken(request, user, scenario.setupToken)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  await logInViaApi(page, user)
  const dialog = await openBankLink(page, everyday.id, 'Not linked')
  await dialog.getByRole('button', { name: 'Link bank account' }).click()

  const flow = page.getByRole('dialog', { name: 'Link bank account' })
  await flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) }).click()
  await flow.getByRole('button', { name: 'Continue' }).click()
  await chooseFirstStart(flow)
  await stopClock(page)
  const linked = page.waitForResponse((answer) =>
    answer.url() === `${API_BASE_URL}/accounts/${everyday.id}/bank-link` && answer.request().method() === 'POST')
  await flow.getByRole('button', { name: 'Link and import' }).click()
  expect((await linked).ok()).toBe(true)
  const message = toast(page, 'Linked. Syncing starts shortly.')
  await runClockUntil(page, async () => await flow.isHidden() && await message.isVisible()
    && await message.evaluate((element) => getComputedStyle(element).opacity) === '1')
  return { dialog, message }
}

/** One frame of a dialogue's entrance, with the heights on screen of the Bank link section's loading cover and of what it covers */
type EntranceFrame = { scale: number; held: boolean; coverHeight: number; contentHeight: number }

/**
 * Records every frame from the one the Bank link section's loading cover first shows in until its
 * dialogue has finished scaling in, or until a few seconds have passed. Runs in the page, since the
 * entrance lasts a fraction of a second
 */
function recordEntrance(): Promise<EntranceFrame[]> {
  const RECORDING_LIMIT_MS = 5_000
  return new Promise((resolve) => {
    const frames: EntranceFrame[] = []
    const startedAt = performance.now()
    const record = () => {
      const spinner = document.querySelector('[role="status"][aria-label="Loading bank link"]')

      // The cover lays its spinner over what it covers, and that is its first child
      const cover = spinner?.parentElement?.parentElement
      const dialog = spinner?.closest<HTMLElement>('[role="dialog"]')
      if (cover && dialog) {
        const scale = dialog.getBoundingClientRect().width / dialog.offsetWidth
        frames.push({
          scale,
          held: cover.style.height !== '',
          coverHeight: cover.getBoundingClientRect().height,
          contentHeight: cover.firstElementChild!.getBoundingClientRect().height,
        })
        if (scale === 1) return resolve(frames)
      }
      if (performance.now() - startedAt > RECORDING_LIMIT_MS) return resolve(frames)
      requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  })
}

/**
 * Opens a new account's Bank link section on a link part way through its first import, from Jan 1, 2026
 * with one of its two windows stored. The page reads the link from the returned answer in place of the
 * server, again on each request, so a test moves the import on by changing it. While a link imports, the
 * app shell reads the user's links every 2 seconds, and a change among them reads the account's link again.
 * The section shows for an account with no link only once the page knows linking is on offer, so the page
 * has read the providers too before a test takes the link away
 */
async function openImportingLink(page: Page, request: APIRequestContext): Promise<{ dialog: Locator; accountId: string; answer: { link: object } }> {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const synced = buildLinkAnswer(everyday.id)
  const answer: { link: object } = {
    link: {
      ...synced,
      import: { kind: 'initial', state: 'running', requested_start: '2026-01-01', windows_total: 2, windows_done: 1, items_found: 12, earliest_returned_date: null },
      sync: { ...synced.sync, state: 'importing' },
    },
  }
  await page.route(`${API_BASE_URL}/bank-sync/links`, (route) => route.fulfill({ json: [answer.link] }))
  await page.route(`${API_BASE_URL}/accounts/${everyday.id}/bank-link`, (route) => route.fulfill({
    json: { account_id: everyday.id, link: answer.link, previous_link: null },
  }))

  await logInViaApi(page, user)
  const providersRead = page.waitForResponse(`${API_BASE_URL}/bank-sync/providers`)
  await openPage(page, `/accounts/${everyday.id}`)
  await page.getByRole('button', { name: /^Bank sync: / }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await expect(dialog.getByText(/^Importing from /)).toBeVisible()
  await (await providersRead).finished()
  return { dialog, accountId: everyday.id, answer }
}

/**
 * Holds back every render React puts off for later, as a busy machine can, until `releaseRenders`. React
 * runs those off a message it posts to itself, so the message waits. One a press or a change to shared
 * state needs at once doesn't wait for a message, and runs straight away still
 */
async function holdRenders(page: Page): Promise<void> {
  await page.evaluate(() => {
    const held: (() => void)[] = []
    const post = MessagePort.prototype.postMessage
    MessagePort.prototype.postMessage = function (this: MessagePort, ...message: unknown[]) {
      held.push(() => Reflect.apply(post, this, message))
    }
    Object.assign(window, {
      releaseRenders: () => {
        MessagePort.prototype.postMessage = post
        for (const send of held) send()
        return held.length
      },
    })
  })
}

/**
 * Lets the renders `holdRenders` held back run, in the order they were put off
 *
 * @returns How many messages were held back, none meaning the hold held nothing
 */
async function releaseRenders(page: Page): Promise<number> {
  return page.evaluate(() => (window as Window & { releaseRenders?: () => number }).releaseRenders!())
}

/** How strongly Unlink shows through the views around it, none once it has gone */
function readUnlinkOpacity(dialog: Locator): Promise<number> {
  return dialog.evaluate((panel) => {
    const button = Array.from(panel.querySelectorAll('button')).find((control) => control.textContent?.trim() === 'Unlink')
    let opacity = 1
    for (let box: Element | null = button ?? null; box; box = box.parentElement) opacity *= Number(getComputedStyle(box).opacity)
    return button ? opacity : 0
  })
}

// How far a button's width may differ from its label's and its own padding and border, in pixels. The label's
// width is fractional and the button's rounds to whole pixels
const LABEL_FIT_TOLERANCE_PX = 1.5

/**
 * Asserts the button is exactly as wide as the label it shows needs, with its own padding and border and no
 * room kept for any other label. It waits for the width to stop easing, which a changed label does
 */
async function expectFitsLabel(button: Locator): Promise<void> {
  await expect.poll(() => button.evaluate((element) => {
    // Still easing, or a label still fading out beside the one that stays
    if (element.getAnimations({ subtree: true }).length > 0) return Number.NaN

    const range = document.createRange()
    range.selectNodeContents(element)
    const style = getComputedStyle(element)
    const chrome = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
      .reduce((total, side) => total + parseFloat(side), 0)
    return Math.abs(element.getBoundingClientRect().width - range.getBoundingClientRect().width - chrome)
  })).toBeLessThanOrEqual(LABEL_FIT_TOLERANCE_PX)
}

// A read the page sends as a test ends can still be on its way through a changed answer when the page
// closes. That would fail a test whose checks all passed
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('links an account from its page, from choosing the bank account to its import', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const [everyday, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createSampleBridgeScenario(request),
  ])
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  await logInViaApi(page, user)
  const dialog = await openBankLink(page, everyday.id, 'Not linked')

  const linkButton = dialog.getByRole('button', { name: 'Link bank account' })
  await expect(linkButton).toBeInViewport()
  await expect(linkButton).toBeFocused()

  // Every open lands there, not only the first
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Bank sync: Not linked. Open bank link' }).click()
  await expect(linkButton).toBeFocused()
  await expect(dialog.getByText('Link a bank account to bring in transactions automatically. Each one waits for your review before reaching a balance.')).toBeVisible()
  await linkButton.click()

  const flow = page.getByRole('dialog', { name: 'Link bank account' })
  await expect(flow.getByText('Choose the bank account')).toBeVisible()
  await expect(flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_VISA}`) })).toContainText(SAMPLE_BANK)
  const continueButton = flow.getByRole('button', { name: 'Continue' })
  // Whole until a press finds no bank account chosen, then faded with the reason until one is
  await expect(continueButton).not.toHaveAttribute('aria-disabled', 'true')
  await continueButton.click()
  await expect(flow.getByRole('alert')).toHaveText('Choose a bank account')
  await expect(continueButton).toHaveAttribute('aria-disabled', 'true')
  await expect(flow.getByRole('radiogroup', { name: 'Bank account' })).toHaveAttribute('aria-invalid', 'true')
  await flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) }).click()
  await expect(flow.getByRole('alert')).toHaveCount(0)
  await expect(continueButton).not.toHaveAttribute('aria-disabled', 'true')
  await continueButton.click()

  await expect(flow.getByText('Choose where history starts')).toBeVisible()
  await expect(flow.getByText(`Choose the days ${SAMPLE_CHEQUING} brings in. Each transaction waits for your review.`)).toBeVisible()
  await expect(flow.getByRole('radio', { checked: true })).toHaveCount(0)
  const submit = flow.getByRole('button', { name: 'Link and import' })
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true')
  await submit.click()
  await expect(flow.getByRole('alert')).toHaveText('Choose where to start')
  await expect(submit).toHaveAttribute('aria-disabled', 'true')

  // Back keeps the bank account chosen
  await flow.getByRole('button', { name: 'Back' }).click()
  await expect(flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) })).toBeChecked()
  await continueButton.click()

  await flow.getByRole('radio', { name: /^3 months/ }).click()

  // The group is one tab stop, the chosen card, and Home and End move to its ends as between native radios
  const startCards = flow.getByRole('radiogroup', { name: 'Start' }).getByRole('radio')
  await expect(flow.getByRole('radio', { name: /^3 months/ })).toHaveAttribute('tabindex', '0')
  await expect(startCards.last()).toHaveAttribute('tabindex', '-1')
  await flow.getByRole('radio', { name: /^3 months/ }).focus()
  await page.keyboard.press('End')
  await expect(startCards.last()).toBeChecked()
  await page.keyboard.press('Home')
  await expect(startCards.first()).toBeChecked()
  await flow.getByRole('radio', { name: /^3 months/ }).click()

  // The import waits for more links, so it hasn't started when the linked view shows. The Bridge is
  // held anyway, in case a worker picks it up. Linking itself sends nothing to the Bridge
  await stallBridge(request, scenario.id)
  try {
    const pageScroll = await page.evaluate(() => window.scrollY)
    const linked = page.waitForRequest((sent) => sent.url() === `${API_BASE_URL}/accounts/${everyday.id}/bank-link` && sent.method() === 'POST')
    await submit.click()

    expect((await linked).postDataJSON()).toEqual({
      connection_id: connection.id,
      external_account_id: externalIdOf(connection, SAMPLE_CHEQUING),
      start_date: firstOfMonthsAgo(3),
    })
    await expect(toast(page, 'Linked. Syncing starts shortly.')).toBeVisible()
    await expect(flow).toBeHidden()
    await expect(fact(dialog, 'Bank account')).toHaveText(SAMPLE_CHEQUING)
    await expect(fact(dialog, 'Institution')).toHaveText(SAMPLE_BANK)
    await expect(fact(dialog, 'Through')).toHaveText('SimpleFIN')
    await expect(fact(dialog, 'Status')).toHaveText(/^Starts soon/)

    // The Link button the flow opened from has gone, so focus moves to the linked view's first live
    // action. The import waits to start, which Sync now starts at once, so Sync now is live and takes it
    const syncNow = dialog.getByRole('button', { name: 'Sync now' })
    await expect(syncNow).toBeFocused()
    await expect(syncNow).not.toHaveAttribute('aria-disabled', 'true')

    // The linked view is taller than the one it replaced, so on a phone it pushes the action below
    // what the modal shows. The modal's own area scrolls to show it whole, leaving the page where it was
    await expect(syncNow).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll)
  } finally {
    // Frees the worker the held request keeps waiting. It would otherwise hold up other tests' syncs
    await clearBridgeFault(request, scenario.id)
  }
})

// The old view says it has faded out before React takes it off the page, in a render of its own, and a
// busy machine can draw a frame in between. Focus is looked after once the view has gone, not on that
// frame, since it still sits on a control about to go and would then fall to the page. Renders are held,
// and the page's clock stopped, so frames pass only as the test moves it on, and they pass with the old
// view still on the page. Motion isn't reduced, as it is for other tests on the page's clock, since the
// fade is what the report of the old view's exit waits for
test('moves focus to Link bank account once the link it sat by is undone elsewhere, however late the old view leaves', NEEDS_BANK_SYNC, async ({ page, request }) => {
  await page.clock.install()
  const { dialog, accountId } = await openImportingLink(page, request)
  const unlink = dialog.getByRole('button', { name: 'Unlink' })
  await expect(unlink).toBeFocused()

  // Undone in another tab. The app shell's next read of the links finds none, and reads the account's
  // again. Every other read the page sends from then waits until focus has moved, since an answer
  // renders at once and would take the held renders along, the old view's exit among them
  await holdRenders(page)
  await stopClock(page)
  let releaseReads = () => {}
  const readsReleased = new Promise<void>((resolve) => { releaseReads = resolve })
  await page.route(`${API_BASE_URL}/**`, async (route) => {
    await readsReleased
    await route.fallback()
  })
  await page.route(`${API_BASE_URL}/bank-sync/links`, (route) => route.fulfill({ json: [] }))
  await page.route(`${API_BASE_URL}/accounts/${accountId}/bank-link`, (route) => route.fulfill({
    json: { account_id: accountId, link: null, previous_link: null },
  }))
  const linkButton = dialog.getByRole('button', { name: 'Link bank account' })
  await runClockUntil(page, async () => (await linkButton.count()) === 1, LINK_READ_CLOCK_STEP_MS)

  // The old view has faded out once nothing of it shows through, and says so on the frame after, so a
  // look at focus a frame later would still find it on Unlink
  await runClockUntil(page, async () => (await readUnlinkOpacity(dialog)) === 0)
  await page.clock.runFor(FRAMES_PAST_FADE_MS)

  // The hold has kept the old view on the page through those frames, and held what takes it off
  expect(await unlink.count()).toBe(1)
  expect(await releaseRenders(page)).toBeGreaterThan(0)

  await runClockUntil(page, async () => (await unlink.count()) === 0 && await linkButton.evaluate((button) => button === document.activeElement))
  await expect(unlink).not.toBeAttached()
  await expect(linkButton).toBeFocused()
  releaseReads()
})

test("keeps the link's message clear of Cancel and Save changes where the edit modal fills the screen, and back in the corner once it closes", NEEDS_BANK_SYNC, async ({ page, request }) => {
  // The widest screen the modal still fills. It stands for every screen the modal fills
  await page.setViewportSize(WIDEST_FULL_SCREEN_MODAL_SIZE)
  const { dialog, message } = await linkFromEditAccount(page, request)
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
  const save = dialog.getByRole('button', { name: 'Save changes', exact: true })

  // Read while the message still shows, since both come out from under it once it goes
  await expect(message).toBeInViewport({ ratio: 1 })
  await expect.poll(async () => await message.isVisible() && await isUncovered(cancel) && await isUncovered(save)).toBe(true)

  // With the modal gone from under it, the message goes back down to the corner while it still shows
  await cancel.click()
  await runClockUntil(page, () => dialog.isHidden())
  await runClockUntil(page, () => isInCorner(message))
  expect(await readMessageInset(message)).toEqual(MESSAGE_IN_CORNER)
})

/**
 * Whether the message has come down to the corner. The message works out its place on every animation
 * frame, and the page's clock is held here, so a test waits for it by moving the clock on
 */
async function isInCorner(message: Locator): Promise<boolean> {
  const { right, bottom } = await readMessageInset(message)
  return right === MESSAGE_IN_CORNER.right && bottom === MESSAGE_IN_CORNER.bottom
}

test("leaves the link's message in the corner, clear of Cancel and Save changes, with the edit modal in the middle", NEEDS_BANK_SYNC, async ({ page, request }) => {
  // The narrowest screen the modal sits in the middle of. The message in the corner comes closest there
  // to its buttons. The footer's padding reaches the corner there without any button doing so, and the
  // message stays down as it does on main
  await page.setViewportSize(NARROWEST_CENTRED_MODAL_SIZE)
  const { dialog, message } = await linkFromEditAccount(page, request)

  await runClockUntil(page, () => isInCorner(message))
  expect(await readMessageInset(message)).toEqual(MESSAGE_IN_CORNER)
  expect(await isUncovered(dialog.getByRole('button', { name: 'Cancel', exact: true }))).toBe(true)
  expect(await isUncovered(dialog.getByRole('button', { name: 'Save changes', exact: true }))).toBe(true)
})

test('reminds the user the import waits for more links in the Bank link section, and starts it at once from Sync now by keyboard', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const [everyday, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createSampleBridgeScenario(request),
  ])
  await claimSetupToken(request, user, scenario.setupToken)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await logInViaApi(page, user)
  const dialog = await openBankLink(page, everyday.id, 'Not linked')
  await dialog.getByRole('button', { name: 'Link bank account' }).click()
  const flow = page.getByRole('dialog', { name: 'Link bank account' })
  await flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) }).click()
  await flow.getByRole('button', { name: 'Continue' }).click()
  await chooseFirstStart(flow)
  await flow.getByRole('button', { name: 'Link and import' }).click()

  await expect(toast(page, 'Linked. Syncing starts shortly.')).toBeVisible()
  await expect(flow).toBeHidden()
  await expect(dialog.getByText(IMPORT_REMINDER)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Start now' })).toHaveCount(0)
  const syncNow = dialog.getByRole('button', { name: 'Sync now' })
  await expect(syncNow).not.toHaveAttribute('aria-disabled', 'true')
  const importStarted = page.waitForResponse((answer) =>
    answer.url().endsWith('/bank-link/sync') && answer.request().method() === 'POST')

  await syncNow.focus()
  await page.keyboard.press('Enter')
  expect((await importStarted).ok()).toBe(true)
  await expect(dialog.getByText(IMPORT_REMINDER)).toHaveCount(0)
})

test("lists the bank accounts that can't be linked with the reason for each", NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const [everyday, household, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createAccount(request, user, { name: 'Household' }),
    createEmptyBridgeScenario(request),
  ])
  const login = await addBridgeBankLogin(request, scenario.id, SAMPLE_BANK)
  await addBridgeBankAccount(request, scenario.id, { connId: login, name: SAMPLE_CHEQUING, currency: 'CAD' })
  await addBridgeBankAccount(request, scenario.id, { connId: login, name: 'US Dollar Savings', currency: 'USD' })
  await addBridgeBankAccount(request, scenario.id, { connId: login, name: 'Flight Miles', currency: 'https://www.simplefin.org/currencies/miles' })
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  await linkBankAccount(request, user, {
    accountId: household.id,
    connectionId: connection.id,
    externalAccountId: externalIdOf(connection, SAMPLE_CHEQUING),
    startDate: todayInTestTimezone(),
  })
  await logInViaApi(page, user)
  const dialog = await openBankLink(page, everyday.id, 'Not linked')
  await dialog.getByRole('button', { name: 'Link bank account' }).click()
  const flow = page.getByRole('dialog', { name: 'Link bank account' })

  const reasons = [
    [SAMPLE_CHEQUING, 'Already linked to Household'],
    ['US Dollar Savings', 'In USD, but Everyday is in CAD'],
    ['Flight Miles', "Uses a currency of its own that Lumina Finance can't track"],
  ]
  for (const [name, reason] of reasons) {
    const card = flow.getByRole('radio', { name: new RegExp(`^${name}`) })
    // Locked and reachable: the reason is in the tooltip on focus, not printed on the card
    await expect(card).toHaveAttribute('aria-disabled', 'true')
    await expect(card).not.toContainText(reason)
    // Reached by Tab, so the focus is the keyboard's and shows the reason
    await card.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(card).toBeFocused()
    await expect(page.getByText(reason).filter({ visible: true })).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(card).toHaveAttribute('aria-checked', 'false')
  }
  // Nothing can be chosen, yet Continue is whole until a press says so
  const continueButton = flow.getByRole('button', { name: 'Continue' })
  await expect(continueButton).not.toHaveAttribute('aria-disabled', 'true')
  await continueButton.click()
  await expect(flow.getByRole('alert')).toHaveText('Choose a bank account')
  await expect(continueButton).toHaveAttribute('aria-disabled', 'true')
})

test("brings an account sent to settings for its first connection back to its link flow once it connects", NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const [everyday, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createSampleBridgeScenario(request),
  ])
  await logInViaApi(page, user)
  const dialog = await openBankLink(page, everyday.id, 'Not linked')
  await dialog.getByRole('button', { name: 'Link bank account' }).click()
  await page.getByRole('dialog', { name: 'Link bank account' }).getByRole('button', { name: 'Open settings' }).click()

  const connect = page.getByRole('dialog', { name: 'Add a connection' })
  await connect.getByRole('textbox', { name: 'Setup token' }).fill(scenario.setupToken)
  await connect.getByRole('button', { name: 'Connect' }).click()

  // The account's page opens with its link flow over it, listing the new connection's bank accounts,
  // and the confirmation leaves out where to link them
  await expect(page).toHaveURL(new RegExp(`/accounts/${everyday.id}$`))
  await expect(toast(page, 'SimpleFIN connected with 2 bank accounts.')).toBeVisible()
  await expect(toast(page, 'SimpleFIN connected')).not.toContainText('Please link each bank account')
  const flow = page.getByRole('dialog', { name: 'Link bank account' })
  await expect(flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) })).toBeVisible({ timeout: WORKER_RESULT_TIMEOUT_MS })
  await expect(page.getByRole('dialog')).toHaveCount(1)
})

test('brings an account sent to settings for another connection back to its link flow on that connection', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const [everyday, sample, lakeside] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createSampleBridgeScenario(request),
    createEmptyBridgeScenario(request),
  ])
  const login = await addBridgeBankLogin(request, lakeside.id, 'Lakeside Credit Union')
  await addBridgeBankAccount(request, lakeside.id, { connId: login, name: 'Joint Savings', currency: 'CAD' })
  await claimSetupToken(request, user, sample.setupToken)
  await logInViaApi(page, user)
  const dialog = await openBankLink(page, everyday.id, 'Not linked')
  await dialog.getByRole('button', { name: 'Link bank account' }).click()

  // With a connection already there, the flow still offers adding another one in Settings
  const flow = page.getByRole('dialog', { name: 'Link bank account' })
  await expect(flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) })).toBeVisible({ timeout: WORKER_RESULT_TIMEOUT_MS })
  await flow.getByRole('button', { name: 'Settings', exact: true }).click()
  const connect = page.getByRole('dialog', { name: 'Add a connection' })
  await connect.getByRole('textbox', { name: 'Setup token' }).fill(lakeside.setupToken)
  await connect.getByRole('button', { name: 'Connect' }).click()

  // Back on the account, the flow starts on the connection just made
  await expect(page).toHaveURL(new RegExp(`/accounts/${everyday.id}$`))
  await expect(flow.getByRole('radio', { name: /^Joint Savings/ })).toBeVisible({ timeout: WORKER_RESULT_TIMEOUT_MS })
  await expect(flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) })).toHaveCount(0)
})

test('sends an account with no connection to settings first', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  const dialog = await openBankLink(page, everyday.id, 'Not linked')
  await dialog.getByRole('button', { name: 'Link bank account' }).click()
  const flow = page.getByRole('dialog', { name: 'Link bank account' })

  await expect(flow.getByText('Connect a provider first')).toBeVisible()
  await expect(flow.getByText('Please add a bank connection in Settings first.')).toBeVisible()
  await expectFitsLabel(flow.getByRole('button', { name: 'Open settings' }))
  await flow.getByRole('button', { name: 'Open settings' }).click()

  // Settings opens with the Connect modal over it, which is what the link is for
  await expect(page).toHaveURL(/\/settings#bank-connections$/)
  const connect = page.getByRole('dialog', { name: 'Add a connection' })
  await expect(connect).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  // The request is cleared from the history entry once it is read
  await expect.poll(() => page.evaluate(() => (history.state as { usr?: unknown } | null)?.usr ?? null)).toBeNull()

  // Closing leaves the user on Settings with focus on the section's own button
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/settings#bank-connections$/)
  await expect(page.getByRole('button', { name: 'Add a connection' })).toBeFocused()

  // Back and forward to the page again never reopens it
  await page.goBack()
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/)
  await page.goForward()
  await expect(page).toHaveURL(/\/settings#bank-connections$/)
  await expect(page.locator('#bank-connections')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('fits the link flow button to the label it shows, easing its width as the label changes', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const [everyday, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createSampleBridgeScenario(request),
  ])
  await claimSetupToken(request, user, scenario.setupToken)
  await logInViaApi(page, user)
  const dialog = await openBankLink(page, everyday.id, 'Not linked')
  await dialog.getByRole('button', { name: 'Link bank account' }).click()
  const flow = page.getByRole('dialog', { name: 'Link bank account' })

  // Continue is as wide as its own label, not as wide as the longer labels the button shows on other steps
  const continueButton = flow.getByRole('button', { name: 'Continue', exact: true })
  await expectFitsLabel(continueButton)
  const continueWidth = (await continueButton.boundingBox())!.width

  await flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) }).click()
  await continueButton.click()
  const submit = flow.getByRole('button', { name: 'Link and import', exact: true })
  await expectFitsLabel(submit)
  const submitWidth = (await submit.boundingBox())!.width
  expect(submitWidth).toBeGreaterThan(continueWidth)

  // Back on the first step the button eases back to fit Continue, the shorter label
  await flow.getByRole('button', { name: 'Back' }).click()
  await expectFitsLabel(continueButton)
  expect((await continueButton.boundingBox())!.width).toBeLessThan(submitWidth)
})

test('opens custom dates at today and keeps From within the range', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const [everyday, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createSampleBridgeScenario(request),
  ])
  await claimSetupToken(request, user, scenario.setupToken)
  await logInViaApi(page, user)
  const dialog = await openBankLink(page, everyday.id, 'Not linked')
  await dialog.getByRole('button', { name: 'Link bank account' }).click()
  const flow = page.getByRole('dialog', { name: 'Link bank account' })
  await flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) }).click()
  await flow.getByRole('button', { name: 'Continue' }).click()

  // The step opens with nothing chosen and the custom dates folded away
  await expect(flow.getByText('Choose where history starts')).toBeVisible()
  const custom = flow.getByRole('radio', { name: /^Custom dates/ })
  const customDates = flow.getByRole('group', { name: 'Custom dates' })
  await expect(flow.getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(customDates).toHaveCount(0)

  // Choosing them unfolds From, empty, and To, at today
  const submit = flow.getByRole('button', { name: 'Link and import' })
  await custom.click()
  await expect(custom).toBeChecked()
  const [year, month, day] = todayInTestTimezone().split('-')
  const to = customDates.getByRole('group', { name: 'To', exact: true })
  await expect(to.getByRole('textbox', { name: 'Year', exact: true })).toHaveValue(year)
  await expect(to.getByRole('textbox', { name: 'Month', exact: true })).toHaveValue(month)
  await expect(to.getByRole('textbox', { name: 'Day', exact: true })).toHaveValue(day)
  await expect(customDates.getByRole('group', { name: 'From', exact: true }).getByRole('textbox', { name: 'Year', exact: true })).toHaveValue('')
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true')

  // A date that is wrong is not called out while it is typed, only once focus leaves it
  // The field's own message, naming the earliest day, not the faded button's tooltip that gives the same reason
  const rangeMessage = flow.getByRole('alert').filter({ hasText: `The earliest start is ${formatDateLabel(firstOfMonthsAgo(12))}` })
  await typeDate(page, 'From', '2020-01-01')
  await expect(rangeMessage).toBeHidden()
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true')
  await flow.getByText('Choose where history starts').click()
  await expect(rangeMessage).toBeVisible()
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true')

  // A press then fades the button until the date is fixed
  await submit.click()
  await expect(submit).toHaveAttribute('aria-disabled', 'true')
  await expect(rangeMessage).toBeVisible()

  await typeDate(page, 'From', firstOfMonthsAgo(2))
  await expect(rangeMessage).toBeHidden()
  await expect(submit).toBeEnabled()
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true')

  // A To left at today asks for no end, so syncing carries on from it
  const linked = page.waitForResponse((answer) => answer.url() === `${API_BASE_URL}/accounts/${everyday.id}/bank-link` && answer.request().method() === 'POST')
  await submit.click()
  const link = await linked
  expect(link.status()).toBe(201)
  expect(link.request().postDataJSON()).toEqual(expect.objectContaining({ start_date: firstOfMonthsAgo(2) }))
  expect(link.request().postDataJSON()).not.toHaveProperty('end_date')
})

test('unlinks the account alone, then reconnects it with the relink wording', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const [everyday, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createSampleBridgeScenario(request),
  ])
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  await linkBankAccount(request, user, {
    accountId: everyday.id,
    connectionId: connection.id,
    externalAccountId: externalIdOf(connection, SAMPLE_CHEQUING),
    startDate: todayInTestTimezone(),
  })
  const listings = watchListings(page)
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${everyday.id}`)

  // Opened once today's import is over, so Sync now is live and takes the focus. The import
  // would have it pass to Unlink. The balance match offered for the gap from the empty ledger
  // doesn't take it either
  const bankSync = page.getByRole('button', { name: /^Bank sync: Synced (just now|\d+ minutes? ago)\. Open bank link$/ })
  await expect(bankSync).toBeVisible({ timeout: WORKER_RESULT_TIMEOUT_MS })
  await bankSync.click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await expect(dialog.getByRole('button', { name: 'Record adjustment' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Sync now' })).toBeFocused()

  // A linked account has no bank account to choose, so none are listed for it
  expect(listings).toEqual([])
  await dialog.getByRole('button', { name: 'Unlink' }).click()

  // Unlinking offers no choice to disconnect the connection, only a line pointing to Settings for it
  const unlink = page.getByRole('dialog', { name: 'Unlink bank account' })
  await expect(unlink.getByText(`${SAMPLE_CHEQUING} at ${SAMPLE_BANK}`)).toBeVisible()
  await expect(unlink.getByText('To disconnect SimpleFIN from every account, please open the connection in Settings.')).toBeVisible()
  await expect(unlink.getByRole('radio')).toHaveCount(0)
  await expectFitsLabel(unlink.getByRole('button', { name: 'Unlink', exact: true }))
  await unlink.getByRole('button', { name: 'Unlink', exact: true }).click()

  // Both dialogues close once the account is unlinked
  await expect(toast(page, 'Everyday unlinked.')).toBeVisible()
  await expect(unlink).toBeHidden()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: /^Bank sync: / }).click()
  await expect(dialog.getByText(
    `Previously linked to ${SAMPLE_CHEQUING} at ${SAMPLE_BANK} through SimpleFIN, until ${formatToday()}. Reconnecting brings in what the bank reported since.`,
  )).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Reconnect bank account' })).toBeFocused()

  await dialog.getByRole('button', { name: 'Reconnect bank account' }).click()
  const flow = page.getByRole('dialog', { name: 'Reconnect bank account' })
  await expect(flow.getByText(`Previously linked to ${SAMPLE_CHEQUING} at ${SAMPLE_BANK}.`)).toBeVisible()
  const chequing = flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) })
  await expect(chequing).toContainText('Same account as before')
  await chequing.click()
  await flow.getByRole('button', { name: 'Continue' }).click()
  await chooseFirstStart(flow)
  await flow.getByRole('button', { name: 'Relink' }).click()

  await expect(toast(page, 'Relinked. Syncing starts shortly.')).toBeVisible()
  await expect(fact(dialog, 'Bank account')).toHaveText(SAMPLE_CHEQUING)
})

test('opens at the bank link with Unlink focused while Sync now is held back with its reason', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const [everyday, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createSampleBridgeScenario(request),
  ])
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  await linkBankAccount(request, user, {
    accountId: everyday.id,
    connectionId: connection.id,
    externalAccountId: externalIdOf(connection, SAMPLE_CHEQUING),
    startDate: todayInTestTimezone(),
  })

  // The page reads bank sync as not set up, so it holds Sync now back whatever the import has reached.
  // The read lands before the modal opens, so the modal knows which action is held as it focuses one
  await changeProviders(page, (body) => {
    body.sync_running = false
  })
  const providersRead = page.waitForResponse(`${API_BASE_URL}/bank-sync/providers`)
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${everyday.id}`)
  await providersRead
  await page.getByRole('button', { name: /^Bank sync: / }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })

  // Focus passes over Sync now, since it would open the reason over the section
  await expect(dialog.getByRole('button', { name: 'Unlink' })).toBeFocused()
  const syncNow = dialog.getByRole('button', { name: 'Sync now' })
  await expect(syncNow).toHaveAttribute('aria-disabled', 'true')

  // The reason is printed under the actions with a link to Settings, and Sync now points at it
  await expect(syncNow).toHaveAccessibleDescription(`${NOT_SET_UP} ${BANK_CONNECTIONS_LINK}`)
  await expect(dialog.getByText(NOT_SET_UP)).toBeVisible()
  const settings = dialog.getByRole('link', { name: BANK_CONNECTIONS_LINK })
  await expect(settings).toHaveAttribute('href', BANK_CONNECTIONS_PATH)
  await settings.click()
  await expect(page).toHaveURL(new RegExp(`${BANK_CONNECTIONS_PATH}$`))
})

/**
 * Opens Everyday's edit modal through the Bank sync fact with the link's read held, so the Bank link
 * section shows its action only once `showSection` lets the read through, after the modal has opened
 * and put focus in Account Name. The section then moves focus to its action a moment later unless the
 * person has moved it first. The page's clock is installed for the test to stop once focus is where the
 * person put it, so that moment comes only as `showSection` moves the clock on, however slowly the read
 * lands
 */
async function openBeforeLinkLoads(page: Page, request: APIRequestContext): Promise<{ dialog: Locator; showSection: () => Promise<void> }> {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const linkUrl = `${API_BASE_URL}/accounts/${everyday.id}/bank-link`
  let answerRead = () => {}
  const readReleased = new Promise<void>((resolve) => { answerRead = resolve })
  await page.route(linkUrl, async (route) => {
    await readReleased
    await route.fallback()
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${everyday.id}`)
  await page.getByRole('button', { name: /^Bank sync: / }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await expect(dialog.getByLabel('Account name')).toBeFocused()

  const showSection = async () => {
    const read = page.waitForResponse((answer) => answer.url() === linkUrl && answer.request().method() === 'GET')
    answerRead()
    await read
    await runClockUntil(page, () => dialog.getByRole('button', { name: 'Link bank account' }).isVisible())
    await page.clock.runFor(OPENING_FOCUS_PASSED_MS)
  }
  return { dialog, showSection }
}

test('leaves focus in Account Name when typing starts there before the Bank link section loads', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { dialog, showSection } = await openBeforeLinkLoads(page, request)
  const name = dialog.getByLabel('Account name')
  await page.keyboard.press('End')
  await page.keyboard.type(' Plus')
  await expect(name).toHaveValue('Everyday Plus')
  await stopClock(page)

  await showSection()
  await expect(name).toBeFocused()
})

test('leaves focus in Account Name when a press lands there before the Bank link section loads', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { dialog, showSection } = await openBeforeLinkLoads(page, request)
  const name = dialog.getByLabel('Account name')
  await name.click()
  await stopClock(page)

  await showSection()
  await expect(name).toBeFocused()
})

// The Bank link section holds its height while it loads, and the dialogue opens around it scaling up from
// a little smaller. A height read off the screen mid-entrance came out short by the dialogue's scale and was
// kept, clipping the section until the hold ended and then letting it jump. The link's read is held for
// the whole entrance, so nothing under the cover changes size while the height held is compared with it.
// The page's clock stops once the page shows the fact, before the dialogue opens, and moves on a frame at a
// time, so the recording starts however long the click takes to land and holds every frame of the
// entrance however rarely a busy machine draws one. Motion isn't reduced, as it is for other tests on the
// page's clock, since the height is held only to ease the section's move and reduced motion leaves that out
test('holds the loading Bank link section at its real height while the dialog scales in', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  await page.route(`${API_BASE_URL}/accounts/${everyday.id}/bank-link`, () => {})
  await page.clock.install()
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${everyday.id}`)
  const bankSync = page.getByRole('button', { name: /^Bank sync: / })
  await expect(bankSync).toBeVisible()
  await stopClock(page)

  let recorded = false
  const entrance = page.evaluate(recordEntrance).finally(() => {
    recorded = true
  })
  await bankSync.click()
  await runClockUntil(page, async () => recorded)
  const frames = await entrance

  const heldWhileScaling = frames.filter((frame) => frame.held && frame.scale < 1)
  expect(heldWhileScaling.length, JSON.stringify(frames)).toBeGreaterThan(0)
  for (const frame of heldWhileScaling) expect(frame.coverHeight, JSON.stringify(frame)).toBeCloseTo(frame.contentHeight, 1)
})

// The link's reads are answered here, since the worker can't be held part way through an import, nor made
// to lose track of the bank account while one runs. The finished import shows for a moment of the page's
// own time, so the page's clock stops before the import finishes and moves on only until it shows, keeping
// it up however long a busy machine takes over the checks on it, and then on until it folds away
test('shows an import that finishes as imported and done before folding it away', NEEDS_BANK_SYNC, async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  const { dialog, accountId, answer } = await openImportingLink(page, request)
  const progress = dialog.getByRole('progressbar', { name: 'Import' })
  await stopClock(page)
  answer.link = buildLinkAnswer(accountId)

  await runClockUntil(page, () => dialog.getByText('12 found · Done').isVisible(), IMPORT_CLOCK_STEP_MS)
  await expect(dialog.getByText(/^Imported from /)).toBeVisible()
  await expect(dialog.getByText('12 found · Done')).toBeVisible()
  await expect(progress).toHaveAttribute('aria-valuenow', '2')
  await runClockUntil(page, async () => await progress.count() === 0, IMPORT_CLOCK_STEP_MS)
  await expect(progress).toHaveCount(0)
})

test('drops an import cut short by its bank account needing to be chosen again without reading as done', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { dialog, accountId, answer } = await openImportingLink(page, request)
  const link = buildLinkAnswer(accountId)
  answer.link = { ...link, state: 'choose_account', sync: { ...link.sync, state: 'choose_account' } }
  await expect(dialog.getByRole('button', { name: 'Choose bank account' })).toBeVisible()

  // Counted once, as the notice shows, since an import shown as done would fold away by itself a moment
  // later. The import still running folds away
  expect(await dialog.getByText(/^Imported from /).count()).toBe(0)
  await expect(dialog.getByRole('progressbar', { name: 'Import' })).toHaveCount(0)
})

test('opens the link flow on the new account’s page when the new-account prompt chooses linking', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  await claimSetupToken(request, user, scenario.setupToken)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  const create = await openModal(page, ['Add account'], 'Add account')
  await chooseFromDropdown(create, 'Account type', 'Checking')
  await create.getByLabel('Account name').fill('Everyday')
  await create.getByRole('button', { name: 'Create account' }).click()

  const prompt = page.getByRole('dialog', { name: 'Keep it up to date' })
  await expect(prompt.getByText('Everyday created')).toBeVisible()
  await expect(prompt.getByRole('radio', { name: /^Link a bank account/ })).toBeChecked()
  await expect(prompt.getByLabel('Starting balance', { exact: true })).toBeHidden()
  await prompt.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]+$/)
  const flow = page.getByRole('dialog', { name: 'Link bank account' })
  await expect(flow.getByText('Choose the bank account')).toBeVisible()
  await expect(flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) })).toBeVisible()

  // Closing the flow leaves the account's page, and a reload doesn't open it again
  await flow.getByRole('button', { name: 'Cancel' }).click()
  await expect(flow).toBeHidden()
  await page.reload()
  await expect(page.getByRole('button', { name: /^Bank sync: Not linked/ })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test.describe("the reason on Link bank account while bank sync isn't set up", () => {
  test.beforeEach(async ({ page, request }) => {
    const user = await signUpUser(request)
    const everyday = await createAccount(request, user, { name: 'Everyday' })
    await changeProviders(page, (body) => {
      body.sync_running = false
    })
    await logInViaApi(page, user)
    await openBankLink(page, everyday.id, 'Not linked')
  })

  test('prints under the button with a link to Settings, Bank connections', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
    const link = dialog.getByRole('button', { name: 'Link bank account' })
    await expect(link).toHaveAccessibleDescription(`${NOT_SET_UP} ${BANK_CONNECTIONS_LINK}`)
    await expect(dialog.getByText(NOT_SET_UP)).toBeVisible()

    const settings = dialog.getByRole('link', { name: BANK_CONNECTIONS_LINK })
    await expect(settings).toHaveAttribute('href', BANK_CONNECTIONS_PATH)
    await settings.click()
    await expect(page).toHaveURL(new RegExp(`${BANK_CONNECTIONS_PATH}$`))

    // Settings opens with Bank connections at the top of the window, and the sections above it loading
    // afterwards don't push it down. Beside the side list it sits 32px from the top. At smaller sizes it
    // sits below the pinned section menu, whose height varies, so only a band is checked there
    const section = page.locator('#bank-connections')
    await expect(section.getByRole('status', { name: 'Loading bank connections' })).toHaveCount(0)
    await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0)
    const sectionTop = async () => Math.round((await section.boundingBox())?.y ?? -1)
    if (test.info().project.name === 'desktop') {
      await expect.poll(sectionTop).toBe(32)
    } else {
      await expect.poll(sectionTop).toBeGreaterThanOrEqual(0)
      await expect.poll(sectionTop).toBeLessThanOrEqual(160)
    }
  })

  test('shows on hover, and Escape puts it away while the modal stays open', NEEDS_BANK_SYNC, async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
    const link = dialog.getByRole('button', { name: 'Link bank account' })
    await expect(link).toHaveAttribute('aria-disabled', 'true')

    await link.hover()
    await expect(shownReason(page, NOT_SET_UP)).toHaveCSS('opacity', '1')
    await page.keyboard.press('Escape')
    // Faded out, or gone from the page once its fade has ended
    await expect.poll(() => shownReason(page, NOT_SET_UP).evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).opacity === '0'))).toBe(true)

    // Pressing it anyway opens nothing, in the modal Escape left open
    await link.click({ force: true })
    await expect(page.getByRole('dialog', { name: 'Link bank account' })).toHaveCount(0)
    await expect(dialog).toBeVisible()
  })
})

test("keeps the new account's prompt manual while bank sync isn't set up, linking to Settings, Bank connections", NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  await changeProviders(page, (body) => {
    body.sync_running = false
  })
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  const create = await openModal(page, ['Add account'], 'Add account')
  await chooseFromDropdown(create, 'Account type', 'Checking')
  await create.getByLabel('Account name').fill('Everyday')
  await create.getByRole('button', { name: 'Create account' }).click()

  const prompt = page.getByRole('dialog', { name: 'Keep it up to date' })
  await expect(prompt.getByRole('radio', { name: /^Link a bank account/ })).toBeDisabled()
  await expect(prompt.getByRole('radio', { name: /^Link a bank account/ })).toContainText(NOT_SET_UP)
  const settings = prompt.getByRole('link', { name: BANK_CONNECTIONS_LINK })
  await expect(settings).toHaveAttribute('href', BANK_CONNECTIONS_PATH)
  await settings.click()
  await expect(page).toHaveURL(new RegExp(`${BANK_CONNECTIONS_PATH}$`))
})

test('holds linking back on an archived account with the reason beside it, listing no bank accounts', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const [everyday, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createSampleBridgeScenario(request),
  ])
  await claimSetupToken(request, user, scenario.setupToken)
  const archived = await request.patch(`${API_BASE_URL}/accounts/${everyday.id}`, { headers: asUser(user), data: { is_archived: true } })
  expect(archived.ok()).toBe(true)
  const listings = watchListings(page)
  await logInViaApi(page, user)
  const dialog = await openBankLink(page, everyday.id, 'Not linked')

  const link = dialog.getByRole('button', { name: 'Link bank account' })
  await expect(link).toBeFocused()
  await expect(link).toHaveAttribute('aria-disabled', 'true')
  await expect(link).toHaveAccessibleDescription(ARCHIVED)
  await expect(link.locator('..').getByText(ARCHIVED, { exact: true })).toBeVisible()
  expect(listings).toEqual([])
})

test('points from the Unlink dialogue to the connection in Settings, where it is disconnected', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const [everyday, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createSampleBridgeScenario(request),
  ])
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  await linkBankAccount(request, user, {
    accountId: everyday.id,
    connectionId: connection.id,
    externalAccountId: externalIdOf(connection, SAMPLE_CHEQUING),
    startDate: todayInTestTimezone(),
  })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${everyday.id}`)
  await page.getByRole('button', { name: /^Bank sync: / }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await dialog.getByRole('button', { name: 'Unlink' }).click()

  const unlink = page.getByRole('dialog', { name: 'Unlink bank account' })
  await unlink.getByRole('button', { name: 'Settings', exact: true }).click()

  // Settings opens with the connection's modal over it, where Disconnect lives
  await expect(page).toHaveURL(/\/settings#bank-connections$/)
  const connectionModal = page.getByRole('dialog')
  await expect(connectionModal).toHaveCount(1)
  await connectionModal.getByRole('button', { name: 'Disconnect' }).click()
  await connectionModal.getByRole('button', { name: 'Yes, disconnect' }).click()

  await expect(toast(page, 'SimpleFIN disconnected. 1 account unlinked.')).toBeVisible()
  await expect.poll(() => readConnection(request, user, connection.id)).toBeUndefined()
})

test('lists the bank accounts of the connection switched to, dropping the one chosen before', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const [everyday, sample, lakeside] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createSampleBridgeScenario(request),
    createEmptyBridgeScenario(request),
  ])
  const login = await addBridgeBankLogin(request, lakeside.id, 'Lakeside Credit Union')
  await addBridgeBankAccount(request, lakeside.id, { connId: login, name: 'Joint Savings', currency: 'CAD' })
  await claimSetupToken(request, user, sample.setupToken)
  await claimSetupToken(request, user, lakeside.setupToken, 'Lakeside')
  await logInViaApi(page, user)
  const dialog = await openBankLink(page, everyday.id, 'Not linked')
  await dialog.getByRole('button', { name: 'Link bank account' }).click()
  const flow = page.getByRole('dialog', { name: 'Link bank account' })

  await flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) }).click()
  await chooseFromDropdown(flow, 'Connection', 'Lakeside')

  await expect(flow.getByRole('radio', { name: /^Joint Savings/ })).toBeVisible()
  await expect(flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) })).toHaveCount(0)
  await expect(flow.getByRole('radio', { checked: true })).toHaveCount(0)
  const continueButton = flow.getByRole('button', { name: 'Continue' })
  await expect(continueButton).not.toHaveAttribute('aria-disabled', 'true')
  await continueButton.click()
  await expect(flow.getByRole('alert')).toHaveText('Choose a bank account')
  await expect(continueButton).toHaveAttribute('aria-disabled', 'true')
})

/** The account page's identity card. It names the account and its institution */
function identityCard(page: Page): Locator {
  return page.locator('section').filter({ has: page.getByRole('button', { name: 'Edit account', exact: true }) })
}

// The identity card names the account's own institution, so the bank's shows there only where the
// account has none. Each look waits for the page to have read the link, since the bank's name comes in
test("names the linked bank's institution on the identity card until the account has one of its own", NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  await linkToSampleBankAccount(request, user, { accountId: everyday.id, bankAccountName: SAMPLE_CHEQUING })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${everyday.id}`)
  const card = identityCard(page)
  await expect(bankSyncFact(page, READ_LINK_STATUS)).toBeVisible()
  await expect(card.getByText(SAMPLE_BANK, { exact: true })).toBeVisible()
  await expect(card.getByText('No institution')).toHaveCount(0)

  const ownName = `Own Credit Union ${crypto.randomUUID()}`
  const institutionId = await createInstitution(request, user, ownName)
  const changed = await request.patch(`${API_BASE_URL}/accounts/${everyday.id}`, { headers: asUser(user), data: { institution_id: institutionId } })
  expect(changed.status()).toBe(200)
  await openPage(page, `/accounts/${everyday.id}`)
  await expect(bankSyncFact(page, READ_LINK_STATUS)).toBeVisible()
  await expect(card.getByText(ownName, { exact: true })).toBeVisible()
  await expect(card.getByText(SAMPLE_BANK, { exact: true })).toHaveCount(0)
})

// The bank's name comes in with the account's bank link, so until that read lands the card can't tell
// whether the account has an institution, and names none. The read is held until both have been looked for
test('names no institution on the identity card while its bank link is being read', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  await linkToSampleBankAccount(request, user, { accountId: everyday.id, bankAccountName: SAMPLE_CHEQUING })
  const linkUrl = `${API_BASE_URL}/accounts/${everyday.id}/bank-link`
  let release = () => {}
  const released = new Promise<void>((resolve) => { release = resolve })
  await page.route(linkUrl, async (route) => {
    await released
    await route.fallback()
  })
  await logInViaApi(page, user)
  const held = page.waitForRequest((sent) => sent.url() === linkUrl && sent.method() === 'GET')
  await openPage(page, `/accounts/${everyday.id}`)
  await held
  const card = identityCard(page)
  await expect(card.getByRole('heading', { name: 'Everyday', exact: true })).toBeVisible()
  await expect(card.getByText(SAMPLE_BANK, { exact: true })).toHaveCount(0)
  await expect(card.getByText('No institution', { exact: true })).toHaveCount(0)

  release()
  await expect(card.getByText(SAMPLE_BANK, { exact: true })).toBeVisible()
  await expect(card.getByText('No institution', { exact: true })).toHaveCount(0)
})

// An account of the user's own says so once its bank link is read and found to be none, and a group
// account straight away, since the page never reads a group account's link
test("says an account with no institution and no bank link has none, whether it's the user's own or a group's", NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const groupId = await createGroup(request, user, 'Household')
  const accounts = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createAccount(request, user, { name: 'Shared bills', groupId }),
  ])
  await logInViaApi(page, user)

  for (const account of accounts) {
    await openPage(page, `/accounts/${account.id}`)
    const card = identityCard(page)
    await expect(card.getByRole('heading', { name: account.name, exact: true })).toBeVisible()
    await expect(card.getByText('No institution', { exact: true })).toBeVisible()
  }
})

// The Bank sync fact takes a row of its own under the account's other facts, so its status has the card's
// whole width rather than half of it, since a status such as "Synced just now" was cut short
test('sets the Bank sync fact on a row of its own across the identity card', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${everyday.id}`)
  const bankSync = bankSyncFact(page, 'Not linked')
  await expect(bankSync).toBeVisible()

  const facts = identityCard(page).locator('dl')
  const row = facts.locator(':scope > *').filter({ has: bankSync })
  const creditLimit = facts.locator(':scope > *').filter({ hasText: 'Credit limit' })
  const [factsBox, rowBox, creditLimitBox] = await Promise.all([facts.boundingBox(), row.boundingBox(), creditLimit.boundingBox()])
  expect(factsBox && rowBox && creditLimitBox).toBeTruthy()
  expect(rowBox!.x).toBeCloseTo(factsBox!.x, 0)
  expect(rowBox!.width).toBeCloseTo(factsBox!.width, 0)
  expect(rowBox!.y).toBeGreaterThanOrEqual(creditLimitBox!.y + creditLimitBox!.height)
})
