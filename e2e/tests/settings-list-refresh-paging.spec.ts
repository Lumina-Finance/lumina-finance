/**
 * Guards the Tags and Merchants lists in Settings against a next page being requested while the list
 * refreshes after an edit. The request used to cancel the refresh and sit beside the old pages, so a
 * row moved or removed by the edit showed twice, went missing or kept its old name until the next refresh
 */
import { expect, test, type APIRequestContext, type Locator } from '@playwright/test'

import { asUser, seedNamedRows, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the lists page the same way at every size

// Three pages of the ten rows a list loads at a time, the last one short
const ROW_COUNT = 25
const PAGE_SIZE = 10
const ROWS_AFTER_TWO_PAGES = 2 * PAGE_SIZE

// Each list is edited by renaming its first row so that it sorts after the last, and every row
// between them moves up by one. Deleting a merchant is left out, since the list refreshes again once the
// delete's spinner ends and that second refresh puts right what the first one lost
const SECTIONS = ['tags', 'merchants'] as const

async function rename(list: Locator, from: string, to: string) {
  await list.getByRole('button', { name: `Edit ${from}`, exact: true }).click()
  await list.getByRole('textbox', { name: `${from} name`, exact: true }).fill(to)
  await list.getByRole('button', { name: `Save ${from}`, exact: true }).click()
}

/**
 * The names the server returns for the first `limit` rows, in its order, leaving out the merchants
 * that ship with the app, since the Settings list does not show them
 */
async function serverNames(request: APIRequestContext, user: TestUser, section: string, limit = 50): Promise<string[]> {
  const response = await request.get(`${API_BASE_URL}/${section}?limit=${limit}&offset=0`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  const rows = (await response.json()) as { name: string; is_system?: boolean }[]
  return rows.filter((row) => !row.is_system).map((row) => row.name)
}

/** The names on the rows the list shows, in the order shown */
async function shownNames(list: Locator): Promise<string[]> {
  const labels = await list
    .getByRole('button', { name: /^Edit / })
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? ''))
  return labels.map((label) => label.replace(/^Edit /, ''))
}

/** Scrolls the list to its end, the move that asks it for the next page */
async function scrollToEnd(list: Locator) {
  await list
    .getByRole('button', { name: /^Edit / })
    .first()
    .evaluate((button) => {
      for (let node = button.parentElement; node; node = node.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) {
          node.scrollTop = node.scrollHeight
          return
        }
      }
      throw new Error('the list has no scrolling ancestor')
    })
}

for (const section of SECTIONS) {
  test(`shows each ${section} row once, as the server has it, after scrolling to the end while the list refreshes`, async ({
    page,
    request,
  }) => {
    const user = await signUpUser(request)
    const prefix = `Paging ${crypto.randomUUID()}`
    const names = Array.from({ length: ROW_COUNT }, (_, index) => `${prefix} ${String(index + 1).padStart(2, '0')}`)
    await seedNamedRows(request, user, section, names)

    // Holds the first request for the list's first page that follows the edit until the test lets
    // it go. That request starts the refresh of the pages already loaded
    const listPath = new URL(`${API_BASE_URL}/${section}`).pathname
    let holdRefresh = false
    let refreshHeld!: () => void
    const refreshReached = new Promise<void>((resolve) => {
      refreshHeld = resolve
    })
    let releaseRefresh!: () => void
    const refreshReleased = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    await page.route(
      (url) => url.pathname === listPath,
      async (route) => {
        const url = new URL(route.request().url())
        if (!holdRefresh || route.request().method() !== 'GET' || url.searchParams.get('offset') !== '0') {
          return route.continue()
        }
        holdRefresh = false
        refreshHeld()
        await refreshReleased
        // The app cancels the request in the version of the list this test guards against
        await route.continue().catch(() => undefined)
      },
    )

    await logInViaApi(page, user)
    await openPage(page, `/settings#${section}`)
    const list = page.locator(`#${section}`)
    await expect.poll(() => shownNames(list)).toEqual(await serverNames(request, user, section, PAGE_SIZE))
    await scrollToEnd(list)
    await expect.poll(() => shownNames(list)).toEqual(await serverNames(request, user, section, ROWS_AFTER_TWO_PAGES))

    holdRefresh = true
    await rename(list, names[0], `${prefix} zz`)
    await refreshReached
    await scrollToEnd(list)
    // The scroll event and what the list does with it have run once two frames have been drawn
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
        }),
    )
    releaseRefresh()

    const expected = await serverNames(request, user, section)
    expect(expected).toHaveLength(ROW_COUNT)
    await expect.poll(() => shownNames(list)).toEqual(expected)
  })
}

// Scrolling once the refresh is over gives the same list as before
test('shows each tag once, as the server has it, after scrolling to the end once the list has refreshed', async ({
  page,
  request,
}) => {
  const user = await signUpUser(request)
  const prefix = `Paging ${crypto.randomUUID()}`
  const names = Array.from({ length: ROW_COUNT }, (_, index) => `${prefix} ${String(index + 1).padStart(2, '0')}`)
  await seedNamedRows(request, user, 'tags', names)

  await logInViaApi(page, user)
  await openPage(page, '/settings#tags')
  const list = page.locator('#tags')
  await expect.poll(() => shownNames(list)).toEqual(await serverNames(request, user, 'tags', PAGE_SIZE))
  await scrollToEnd(list)
  await expect.poll(() => shownNames(list)).toEqual(await serverNames(request, user, 'tags', ROWS_AFTER_TWO_PAGES))

  const renamed = `${prefix} zz`
  await rename(list, names[0], renamed)
  await expect(list.getByRole('button', { name: `Edit ${names[0]}`, exact: true })).toHaveCount(0)
  // The refresh's answers settle once the first tag has dropped out of the loaded pages
  await expect.poll(() => shownNames(list)).toEqual(names.slice(1, ROWS_AFTER_TWO_PAGES + 1))
  await scrollToEnd(list)

  const expected = await serverNames(request, user, 'tags')
  expect(expected.at(-1)).toBe(renamed)
  await expect.poll(() => shownNames(list)).toEqual(expected)
})

// A refresh that starts while the next page is still loading cancels that page. The person asked for
// it, so the page is asked for again once the refresh ends
test('loads the next tags page again when a refresh cancels it on its way', async ({ page, request }) => {
  const user = await signUpUser(request)
  const prefix = `Paging ${crypto.randomUUID()}`
  const names = Array.from({ length: ROW_COUNT }, (_, index) => `${prefix} ${String(index + 1).padStart(2, '0')}`)
  await seedNamedRows(request, user, 'tags', names)

  // Holds the request for the second page, so the refresh the rename starts finds it still loading
  const tagsPath = new URL(`${API_BASE_URL}/tags`).pathname
  const offsetOf = (url: string) => new URL(url).searchParams.get('offset')
  let holdNextPage = false
  let nextPageHeld!: () => void
  const nextPageReached = new Promise<void>((resolve) => {
    nextPageHeld = resolve
  })
  let releaseNextPage!: () => void
  const nextPageReleased = new Promise<void>((resolve) => {
    releaseNextPage = resolve
  })
  await page.route(
    (url) => url.pathname === tagsPath,
    async (route) => {
      if (!holdNextPage || route.request().method() !== 'GET' || offsetOf(route.request().url()) !== String(PAGE_SIZE)) {
        return route.continue()
      }
      holdNextPage = false
      nextPageHeld()
      await nextPageReleased
      // The app cancels the request when the refresh starts
      await route.continue().catch(() => undefined)
    },
  )

  await logInViaApi(page, user)
  await openPage(page, '/settings#tags')
  const list = page.locator('#tags')
  await expect.poll(() => shownNames(list)).toEqual(await serverNames(request, user, 'tags', PAGE_SIZE))

  holdNextPage = true
  await scrollToEnd(list)
  await nextPageReached

  // The renamed row is the last one loaded, so the refresh moves it past the rows still to come
  const refreshRequested = page.waitForRequest(
    (req) => req.method() === 'GET' && new URL(req.url()).pathname === tagsPath && offsetOf(req.url()) === '0',
  )
  await rename(list, names[PAGE_SIZE - 1], `${prefix} zz`)
  await refreshRequested
  releaseNextPage()

  const expected = await serverNames(request, user, 'tags', ROWS_AFTER_TWO_PAGES)
  await expect.poll(() => shownNames(list)).toEqual(expected)
})
