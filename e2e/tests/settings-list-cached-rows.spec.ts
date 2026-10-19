/**
 * Guards the Tags and Merchants lists in Settings against showing their empty message while rows they
 * already hold are on the way to the screen, which they did when a frame callback that empties the
 * list ran after the cached rows had been installed
 */
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { asUser, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the lists behave the same at every size

// How long the page holds back animation frame callbacks, so the list's own frame callback runs
// after its rows are installed, an order the app leaves to timing
const FRAME_DELAY_MS = 100

const LISTS = [
  { section: 'tags', endpoint: 'tags', emptyMessage: /^No tags (yet|match your search)\.$/ },
  { section: 'merchants', endpoint: 'merchants', emptyMessage: /^No merchants (yet|match your search)\.$/ },
] as const

async function seedList(request: APIRequestContext, user: TestUser, endpoint: string, names: string[]) {
  for (const name of names) {
    const created = await request.post(`${API_BASE_URL}/${endpoint}`, { headers: asUser(user), data: { name } })
    expect(created.status()).toBe(201)
  }
}

/**
 * Makes the page run animation frame callbacks `FRAME_DELAY_MS` late and starts recording whether
 * an empty message is ever put on the page
 */
async function watchForEmptyMessage(page: Page, emptyMessage: RegExp): Promise<void> {
  await page.evaluate(({ delay, source, flags }) => {
    const pattern = new RegExp(source, flags)
    const state = window as unknown as { emptyMessageShown: boolean }
    state.emptyMessageShown = false
    new MutationObserver(() => {
      for (const paragraph of document.querySelectorAll('p')) {
        if (pattern.test(paragraph.textContent ?? '')) state.emptyMessageShown = true
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true })

    const requestFrame = window.requestAnimationFrame.bind(window)
    const cancelFrame = window.cancelAnimationFrame.bind(window)
    const held = new Map<number, number>()
    let nextHeldId = 1_000_000_000
    window.requestAnimationFrame = (callback) => {
      const id = nextHeldId++
      held.set(id, window.setTimeout(() => {
        held.delete(id)
        requestFrame(callback)
      }, delay))
      return id
    }
    window.cancelAnimationFrame = (id) => {
      const timeoutId = held.get(id)
      if (timeoutId === undefined) return cancelFrame(id)
      window.clearTimeout(timeoutId)
      held.delete(id)
    }
  }, { delay: FRAME_DELAY_MS, source: emptyMessage.source, flags: emptyMessage.flags })
}

/**
 * How opaque the most visible match is on the page, counting every ancestor's opacity, or 0 when
 * nothing matches. The loading region keeps the rows of the search it replaces in the page, hidden
 * behind its loader, so what shows is read from their opacity rather than from their presence
 */
async function paintedOpacity(locator: Locator): Promise<number> {
  return locator.evaluateAll((elements) => Math.max(0, ...elements.map((element) => {
    let opacity = 1
    for (let node: Element | null = element; node; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity)
    }
    return opacity
  })))
}

/** The patched frame timing has to be in force, or a test would pass for any ordering */
async function expectFramesDelayed(page: Page): Promise<void> {
  const lateBy = await page.evaluate(async () => {
    const startedAt = performance.now()
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    return performance.now() - startedAt
  })
  expect(lateBy).toBeGreaterThanOrEqual(FRAME_DELAY_MS)
}

/** Resolves once every frame callback requested so far has run and React has drawn what it set */
async function letDelayedFramesRun(page: Page): Promise<void> {
  await page.evaluate(async (delay) => {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    await new Promise((resolve) => window.setTimeout(resolve, delay))
  }, FRAME_DELAY_MS)
}

for (const { section, endpoint, emptyMessage } of LISTS) {
  test(`keeps the ${section} list's cached rows on screen when returning to Settings`, async ({ page, request }) => {
    const user = await signUpUser(request)
    const prefix = `Cached ${crypto.randomUUID()}`
    const names = [`${prefix} one`, `${prefix} two`, `${prefix} three`]
    await seedList(request, user, endpoint, names)

    await logInViaApi(page, user)
    await openPage(page, `/settings#${section}`)
    const list = page.locator(`#${section}`)
    for (const name of names) await expect(list.getByRole('button', { name: `Edit ${name}`, exact: true })).toBeVisible()

    await watchForEmptyMessage(page, emptyMessage)
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
    await expect(list).toHaveCount(0)

    await expectFramesDelayed(page)

    await page.goBack()
    await expect(list).toBeVisible()
    for (const name of names) await expect(list.getByRole('button', { name: `Edit ${name}`, exact: true })).toBeVisible()
    await letDelayedFramesRun(page)

    expect(await page.evaluate(() => (window as unknown as { emptyMessageShown: boolean }).emptyMessageShown)).toBe(false)
    for (const name of names) await expect(list.getByRole('button', { name: `Edit ${name}`, exact: true })).toBeVisible()
  })
}

// Tags only, since the merchants list holds its rows in a loading region that already covers the
// frames in between, so its empty message never reaches the page this way
test('keeps the tags list rows on screen when returning to a warmed search with reduced motion', async ({ page, request }) => {
  const user = await signUpUser(request)
  const alpha = `Alpha ${crypto.randomUUID()}`
  const beta = `Beta ${crypto.randomUUID()}`
  await seedList(request, user, 'tags', [alpha, beta])

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await logInViaApi(page, user)
  await openPage(page, '/settings#tags')
  const list = page.locator('#tags')
  const search = list.getByPlaceholder('Search tags...')
  const row = (name: string) => list.getByRole('button', { name: `Edit ${name}`, exact: true })

  // Each search is run once so that returning to it is served from what the page already holds
  await search.fill(alpha)
  await expect(row(alpha)).toBeVisible()
  await search.fill(beta)
  await expect(row(beta)).toBeVisible()
  await expect(row(alpha)).toHaveCount(0)

  await watchForEmptyMessage(page, LISTS[0].emptyMessage)
  await expectFramesDelayed(page)
  await search.fill(alpha)
  await expect(row(alpha)).toBeVisible()
  await letDelayedFramesRun(page)

  expect(await page.evaluate(() => (window as unknown as { emptyMessageShown: boolean }).emptyMessageShown)).toBe(false)
  await expect(row(alpha)).toBeVisible()
  await expect(row(beta)).toHaveCount(0)
})

test('replaces the tags with a loader while a new search loads, then restores the full list when it is cleared', async ({ page, request }) => {
  const user = await signUpUser(request)
  const wanted = `Gamma ${crypto.randomUUID()}`
  const other = `Delta ${crypto.randomUUID()}`
  await seedList(request, user, 'tags', [wanted, other])

  // Holds the answer to the new search, so the wait for it can be looked at
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const tagsPath = new URL(`${API_BASE_URL}/tags`).pathname
  await page.route((url) => url.pathname === tagsPath, async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') === wanted) await held
    await route.continue()
  })

  await logInViaApi(page, user)
  await openPage(page, '/settings#tags')
  const list = page.locator('#tags')
  const row = (name: string) => list.getByRole('button', { name: `Edit ${name}`, exact: true })
  await expect(row(wanted)).toBeVisible()
  await expect(row(other)).toBeVisible()

  await list.getByPlaceholder('Search tags...').fill(wanted)
  await expect(list.getByRole('status', { name: 'Loading tags' })).toBeVisible()
  await expect.poll(() => paintedOpacity(row(other))).toBe(0)
  await expect.poll(() => paintedOpacity(row(wanted))).toBe(0)

  release()
  await expect(row(wanted)).toBeVisible()
  await expect(list.getByRole('status', { name: 'Loading tags' })).toHaveCount(0)
  await expect(row(other)).toHaveCount(0)

  await list.getByPlaceholder('Search tags...').fill('')
  await expect(row(wanted)).toBeVisible()
  await expect(row(other)).toBeVisible()
})
