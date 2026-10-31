/**
 * Driving the parts of the app a spec passes through on its way to the behaviour it tests.
 */

import { expect, type CDPSession, type Locator, type Page, type Response } from '@playwright/test'

import { TEST_PASSWORD, type TestUser } from './api'
import { waitForConfirmationLink } from './mail'
import { API_BASE_URL, BASE_URL } from './target'

// The app's own two breakpoints. Above the first the navigation is a sidebar and below it a
// menu behind a button. Above the second the list toolbars show their controls inline, and
// below it a reduced set that opens filtering in a sheet
const NAVIGATION_BREAKPOINT_PX = 1050
const TOOLBAR_BREAKPOINT_PX = 750

// Where the import page puts its setup panel beside the steps rather than above them, and where
// the panel collapses by itself once a file is accepted
const IMPORT_SIDE_BY_SIDE_BREAKPOINT_PX = 1280

/** Adds a virtual authenticator that answers the browser's passkey prompts, so they run for real */
export async function addPasskeyAuthenticator(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  })
  return cdp
}

/**
 * Runs the native passkey page's prompt with the server's options and returns the credential it sends
 * the app. Chrome won't open a luminafinance:// address, so the page's request to go there is read instead
 *
 * @param page - Page whose virtual authenticator answers the prompt
 * @param cdp - The session `addPasskeyAuthenticator` returned for that page
 * @param ceremony - `create` to register a passkey, `get` to sign in with one
 * @param options - The server's options for the ceremony, as the response text
 */
export async function runNativeCeremony(page: Page, cdp: CDPSession, ceremony: 'create' | 'get', options: string) {
  const callback = new Promise<URL>((resolve) => {
    const listener = ({ url }: { url: string }) => {
      if (!url.startsWith('luminafinance:')) return
      cdp.off('Page.frameRequestedNavigation', listener)
      resolve(new URL(url))
    }
    cdp.on('Page.frameRequestedNavigation', listener)
  })
  // Each sheet opens the page afresh, where a change of fragment alone wouldn't load it again
  await page.goto('about:blank')
  await page.goto(`/native/passkey#${new URLSearchParams({ ceremony, options })}`)
  const credential = (await callback).searchParams.get('credential')
  expect(credential).toBeTruthy()
  return JSON.parse(credential ?? '') as unknown
}

/**
 * Whether the page is at least this wide, as the app's own media queries see it.
 *
 * Asked of the page rather than worked out from the configured viewport, because a classic
 * scrollbar takes its width out of the layout viewport, so the two numbers differ by fifteen
 * on any project that draws one.
 *
 * @param page - Page to measure
 * @param widthPx - Width to compare against
 * @returns Whether the app's layout is at or above that width
 */
async function isAtLeast(page: Page, widthPx: number): Promise<boolean> {
  return page.evaluate((px) => matchMedia(`(min-width: ${px}px)`).matches, widthPx)
}

/**
 * Sign in through the login form and wait until the app leaves the login page.
 *
 * Waits for the response and route transition separately from assertions on page data
 *
 * @param page - Page to drive, at any address in the app
 * @param user - Credentials to sign in with
 */
export async function logIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)

  const authenticated = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/auth/login` && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Log in' }).click()
  expect((await authenticated).status()).toBe(200)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await waitForPageReady(page)
}

/**
 * Fill the sign-up form with a fresh address, press Sign up and wait for the "Check your email" view.
 *
 * The form asks for no password, and nothing is created until the emailed link is opened. Timezone
 * and base currency keep the browser's own defaults, which the config pins, so the form needs no
 * answer for either
 *
 * @param page - Page to drive, at any address in the app
 * @param email - Address to sign up, a fresh one when omitted
 * @returns The address that was submitted
 */
export async function requestSignUpThroughTheForm(
  page: Page,
  email = `e2e-${crypto.randomUUID()}@example.com`,
): Promise<string> {
  await page.goto('/signup')
  await page.getByLabel('First name').fill('Test')
  await page.getByLabel('Last name').fill('User')
  await page.getByLabel('Email').fill(email)

  // Sign up stays disabled until the currency list arrives, which Playwright waits out
  await page.getByRole('button', { name: 'Sign up', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Check your email to finish creating your account')
  return email
}

/**
 * Sign up through the form, open the emailed link and choose a password, stopping at the
 * "Account created" step that offers a second factor.
 *
 * The session is held back until that step is finished or skipped, so the app is not open yet
 *
 * @param page - Page to drive, at any address in the app
 * @returns The address that signed up, whose password is `TEST_PASSWORD`
 */
export async function signUpThroughTheForm(page: Page): Promise<string> {
  const email = await requestSignUpThroughTheForm(page)
  await page.goto(await waitForConfirmationLink(email))
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByLabel('Confirm password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible()
  return email
}

/** Start a separate real browser session so its rotation cannot invalidate API fixture credentials */
export async function logInViaApi(page: Page, user: TestUser): Promise<void> {
  const response = await page.request.post(`${API_BASE_URL}/auth/login`, {
    data: { email: user.email, password: user.password },
  })
  expect(response.status()).toBe(200)
  const body = await response.json() as { access_token?: string }
  expect(body.access_token).toEqual(expect.any(String))
  const cookies = await page.context().cookies(`${API_BASE_URL}/auth/refresh`)
  expect(cookies.some((cookie) => cookie.name === 'refresh_token')).toBe(true)

  // The session flag makes AuthProvider exchange the real HttpOnly cookie through /auth/refresh. The
  // app then replaces it with the user's id, which a later load keeps, since the saved query cache
  // restores only under the id it was saved with
  await page.addInitScript((origin) => {
    if (location.origin === origin && localStorage.getItem('lumina:has_session') === null) {
      localStorage.setItem('lumina:has_session', '1')
    }
  }, new URL(BASE_URL).origin)
}

/**
 * Wait for a new document or an identified destination route to finish its entrance
 *
 * The app opens on its recovery screen instead when its start-up requests fail, such as a currency list
 * slower than its limit on a busy host. That screen never becomes the page, so the wait fails as soon as
 * it shows, naming it, rather than sitting out the whole test timeout
 */
export async function waitForPageReady(page: Page): Promise<void> {
  const ready = page.locator('#app-page-content[aria-busy="false"]')
  const recoveryScreen = page.getByRole('heading', { name: 'OK this was not in the plan' })
  await ready.or(recoveryScreen).first().waitFor({ state: 'visible' })
  if (await recoveryScreen.isVisible()) {
    throw new Error('The app opened on its recovery screen instead of the page, so a start-up request such as the currency list failed or ran past its limit')
  }
}

// The local storage key the app saves its query cache under, QUERY_CACHE_STORAGE_KEY in the
// frontend's src/api/cache/persistence.ts. Written out here because the suite runs as its own
// package, with none of the frontend's source beside it
export const SAVED_QUERY_CACHE_KEY = 'lumina:query-cache'

/**
 * Wait until the query cache the app saves in this browser holds every one of these texts
 *
 * The app saves its cache at most once a second while it runs, so a spec that needs a later reload
 * to find something already saved waits for it here rather than for a fixed time
 *
 * @param page - Page whose saved cache to read
 * @param texts - Texts the saved cache must contain, such as a record's id
 */
export async function waitForSavedCache(page: Page, texts: string[]): Promise<void> {
  await expect.poll(() => page.evaluate(({ key, wanted }) => {
    const saved = localStorage.getItem(key) ?? ''
    return wanted.every((text) => saved.includes(text))
  }, { key: SAVED_QUERY_CACHE_KEY, wanted: texts })).toBe(true)
}

/** Navigate to an authenticated page and wait for its actual route readiness signal */
export async function openPage(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await waitForPageReady(page)
}

/**
 * Load every page of the transaction list, returning once it says it has reached the end.
 *
 * The list loads fifteen rows at a time, a page each time its end comes into view, and may load the
 * next one on its own while its end is still in view. A single scroll can land before the page above
 * it has grown the list and miss the next page, so each scroll waits for its page to start and finish
 * loading before the next, and a count read afterwards can't catch the list part way through a page
 *
 * @param page - Page showing the transaction list
 */
export async function loadEveryTransaction(page: Page): Promise<void> {
  const loadingMore = page.getByText(/^Loading more transactions/)
  const reachedEnd = page.getByText("You've reached the end.")
  await expect(loadingMore).toBeHidden()
  while (!(await reachedEnd.isVisible())) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(loadingMore.or(reachedEnd)).toBeVisible()
    await expect(loadingMore).toBeHidden()
  }
}

// The save that finishes an import, of a CSV file or of a journal from another app
const IMPORT_COMMIT_PATH = /\/transactions\/import\/runs\/[^/]+(\/journal)?\/commit$/

/**
 * Click Commit import and wait, under the test's own limit, for the server to answer the save.
 *
 * An import sends its requests one after another, and on a busy host they can outlast an assertion's
 * wait, so a check of the overlay timed from the click races the server. Once the save has answered,
 * the overlay has only its own fixed pauses left before it shows the outcome
 *
 * @param page - Page showing a staged import
 * @param options.via - How the button is pressed: a pointer click, Enter after focusing it, which leaves the
 * pointer where it is, or a bare click event with no pointer press, key or focus before it, as an assistive technology sends
 * @returns The save's response, whatever its status
 */
export async function commitImport(page: Page, { via = 'click' }: { via?: 'click' | 'keyboard' | 'event' } = {}): Promise<Response> {
  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  const committed = page.waitForResponse((response) => response.request().method() === 'POST'
    && IMPORT_COMMIT_PATH.test(new URL(response.url()).pathname), { timeout: 0 })
  if (via === 'keyboard') await commit.press('Enter')
  else if (via === 'event') await commit.dispatchEvent('click')
  else await commit.click()
  return committed
}

/**
 * Brings the import's setup panel back over the steps by hovering its strip, so the data source and
 * the files in it can be reached
 *
 * On desktop the panel collapses once a file is accepted and shows only while the pointer is on it,
 * so a step that touches it holds the pointer there until it is done. Waits for the collapse, so it
 * is called only with an accepted file. Below desktop the panel never collapses of itself and there
 * is nothing to do
 *
 * @param page - Page showing a staged import
 */
export async function showImportSetup(page: Page): Promise<void> {
  if (!await isAtLeast(page, IMPORT_SIDE_BY_SIDE_BREAKPOINT_PX)) return
  const strip = page.getByRole('button', { name: 'Expand import setup', exact: true })
  await expect(strip).toBeVisible()
  // A pointer that chose the file is still, by the browser's reckoning, on the setup column it collapsed
  // under, so moving onto the strip would send no pointer-enter and the panel would stay out only while
  // something in it had focus. Moving off first makes the move onto the strip an entry
  await page.mouse.move(0, 0)
  await strip.hover()
}

// How long the setup panel's collapse and expand take, as the page has it, which a spec cannot import
export const IMPORT_SETUP_MOTION_MS = 240

/**
 * Waits on the page's own frames for longer than a collapse takes, so a panel that was going to
 * collapse has done so, which a wait for the panel to stay would not otherwise tell
 *
 * @param page - Page showing an import
 */
export async function waitPastMotion(page: Page): Promise<void> {
  await page.evaluate((motionMs) => new Promise<void>((done) => {
    const start = performance.now()
    const tick = () => (performance.now() - start >= 2 * motionMs ? done() : requestAnimationFrame(tick))
    tick()
  }), IMPORT_SETUP_MOTION_MS)
}

/**
 * Moves focus and the pointer out of the import's setup panel, which stays slid out over the steps
 * beside it while the pointer is on it, as it is after `showImportSetup`. On desktop it then expects
 * the panel back at its strip, so a panel that stays open fails here
 *
 * @param page - Page showing an import
 */
export async function leaveImportSetup(page: Page): Promise<void> {
  await page.getByRole('heading', { name: 'Import transactions' }).click()
  if (!await isAtLeast(page, IMPORT_SIDE_BY_SIDE_BREAKPOINT_PX)) return
  await expect(page.getByRole('button', { name: 'Expand import setup', exact: true })).toHaveAttribute('aria-expanded', 'false')
}

/**
 * Ends the editing of the import's dates, which is what makes the rest of the page take them, by
 * moving the pointer and focus off the setup panel. On desktop the panel then goes back to its strip
 * unless a date in it holds it open, so a step that touches the dates again calls `showImportSetup`
 *
 * @param page - Page showing a staged import
 */
export async function applyImportDates(page: Page): Promise<void> {
  await page.getByRole('heading', { name: 'Import transactions' }).click()
}

/**
 * Types an ISO date into the import's date field with the given label
 *
 * @param page - Page showing a staged import
 * @param label - The field's label, such as Start date
 * @param iso - The date as yyyy-mm-dd
 * @returns The date field
 */
export async function typeDate(page: Page, label: string, iso: string): Promise<Locator> {
  const field = page.getByRole('group', { name: label, exact: true })
  const [year, month, day] = iso.split('-')
  await field.getByRole('textbox', { name: 'Year', exact: true }).fill(year)
  await field.getByRole('textbox', { name: 'Month', exact: true }).fill(month)
  await field.getByRole('textbox', { name: 'Day', exact: true }).fill(day)
  return field
}

/**
 * Sign in with the password, which opens the second-factor step for a user with TOTP.
 *
 * @param page - Page to drive, at any address in the app
 * @param user - Credentials of a user who has two-factor on
 */
export async function reachTwoFactorChallenge(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByLabel('One-time code')).toBeVisible()
}

/**
 * Assert the app is showing its signed-in shell.
 *
 * The navigation is the thing that says so, and it only renders for a signed-in user past the
 * boot splash. Which half of it to read depends on the width: the sidebar carries the links
 * themselves, while the menu keeps them behind a button and mounts them only once it is open.
 *
 * @param page - Page to assert on
 */
export async function expectSignedIn(page: Page): Promise<void> {
  await waitForPageReady(page)
  const signedIn = (await isAtLeast(page, NAVIGATION_BREAKPOINT_PX))
    ? page.getByRole('link', { name: 'Accounts' })
    : page.getByRole('button', { name: 'Open navigation menu' })

  await expect(signedIn).toBeVisible()
}

/**
 * Filter the transaction list down to one category, and apply it.
 *
 * Two different control sets do this job. Above the toolbar breakpoint it is a pill that opens
 * a panel of tabs; below it a sheet whose first control is a dropdown rather than tabs, and
 * that dropdown is named by the sheet's Filters heading
 *
 * @param page - Page showing the transaction list
 * @param categoryName - Exact name of the category to keep
 */
export async function filterByCategory(page: Page, categoryName: string): Promise<void> {
  if (await isAtLeast(page, TOOLBAR_BREAKPOINT_PX)) {
    await page.getByRole('button', { name: 'Transaction filters' }).click()
    await page.getByRole('tab', { name: 'Category' }).click()
    await page.getByRole('checkbox', { name: categoryName }).click()
    await page.getByRole('button', { name: 'Apply filters' }).click()
    return
  }

  await page.getByRole('button', { name: 'Filters', exact: true }).click()

  const sheet = page.getByRole('dialog', { name: 'Transaction filters' })
  await sheet.getByRole('combobox', { name: 'Filters', exact: true }).click()
  await sheet.getByRole('option', { name: 'Category' }).click()
  await sheet.getByRole('checkbox', { name: categoryName }).click()
  await sheet.getByRole('button', { name: 'Apply filters' }).click()
}

/**
 * Open a modal from a toolbar button, and answer with the dialog once it has placed its opening focus.
 *
 * The authenticated route waits for currencies before becoming ready, so the opener can be
 * clicked once after the route finishes loading
 *
 * @param page - Page showing the toolbar
 * @param buttonNames - Accessible names of the button that opens the modal, one per toolbar,
 *   since the reduced toolbar below the breakpoint calls the same control something else
 * @param dialogName - Accessible name of the dialog it opens
 * @returns The dialog, to scope every query inside it
 */
export async function openModal(page: Page, buttonNames: string[], dialogName: string): Promise<Locator> {
  await waitForPageReady(page)
  const dialog = page.getByRole('dialog', { name: dialogName })

  // Only one toolbar is ever displayed, so only one of these names is in the accessibility
  // tree and the pair resolves to a single control at any width
  //
  // Anything inside an open dialog is excluded, because the transaction modal's own submit
  // button carries the same name as the toolbar button that opened it
  const outsideDialogs = page.locator(':not([role="dialog"] *)')
  const opener = buttonNames
    .map((name) => page.getByRole('button', { name, exact: true }).and(outsideDialogs))
    .reduce((all, one) => all.or(one))

  await opener.click()
  await expect(dialog).toBeVisible()
  // A dialog moves focus onto its first field a frame after it opens, and on a busy host that frame can
  // land after the dialog shows, taking focus from wherever the spec has moved it. Focus starts on the
  // opener outside the dialog, so it's inside once the dialog has placed it
  await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true)

  return dialog
}

/**
 * Pick an option from one of the app's dropdowns.
 *
 * The dropdown is a button that opens a listbox rather than a native select, so this is two
 * clicks. The listbox renders inside the dropdown rather than at the top of the document, which
 * is why the options are found within the same scope.
 *
 * @param scope - Dialog or page holding the field
 * @param fieldName - Accessible name of the dropdown
 * @param optionName - Accessible name of the option to pick
 */
export async function chooseFromDropdown(
  scope: Locator,
  fieldName: string,
  optionName: string | RegExp,
): Promise<void> {
  await scope.getByRole('combobox', { name: fieldName }).click()
  await scope.getByRole('option', { name: optionName }).click()
}

export interface ScrollingBoxPosition {
  /** How far the box is scrolled from its top, in CSS pixels */
  top: number

  /** How much further it could scroll down, in CSS pixels */
  remaining: number

  /** The box's own bottom padding, which sits below its last content when scrolled to the end */
  paddingBottom: number

  /** The height the box shows at once */
  clientHeight: number

  /** Where the element ends, measured from the top of the box's content rather than of what it shows */
  elementBottom: number
}

/**
 * Read where the box that scrolls an element, such as a dialog's body, is scrolled to, and where the
 * element sits in it.
 *
 * @param inside - The element, which any element the box holds will do for reading the scroll alone
 * @returns The box's scroll position and the element's place in its content
 * @throws When nothing above the element scrolls
 */
export async function readScrollingBox(inside: Locator): Promise<ScrollingBoxPosition> {
  return inside.evaluate((element) => {
    let box = element.parentElement
    while (box && !['auto', 'scroll'].includes(getComputedStyle(box).overflowY)) box = box.parentElement
    if (!box) throw new Error('nothing above the element scrolls')
    return {
      top: box.scrollTop,
      remaining: box.scrollHeight - box.clientHeight - box.scrollTop,
      paddingBottom: Number.parseFloat(getComputedStyle(box).paddingBottom),
      clientHeight: box.clientHeight,
      elementBottom: element.getBoundingClientRect().bottom - box.getBoundingClientRect().top + box.scrollTop,
    }
  })
}

/**
 * Wait until the box that scrolls an element stops moving, such as after a smooth scroll, and read
 * where it rests.
 *
 * @param inside - The element, as for `readScrollingBox`
 * @returns The box's resting scroll position and the element's place in its content
 */
export async function readSettledScrollingBox(inside: Locator): Promise<ScrollingBoxPosition> {
  let last: ScrollingBoxPosition | undefined
  await expect.poll(async () => {
    const current = await readScrollingBox(inside)
    const isStill = current.top === last?.top
    last = current
    return isStill
  }).toBe(true)
  return last!
}

/**
 * Measure the room left between the element's bottom and the bottom of what its scrolling box shows.
 *
 * @param position - A reading from `readScrollingBox` or `readSettledScrollingBox`
 * @returns The room in CSS pixels, negative when the element runs past what the box shows
 */
export function roomBelow(position: ScrollingBoxPosition): number {
  return position.top + position.clientHeight - position.elementBottom
}
