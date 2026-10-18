/**
 * Guards the Tags and Merchants lists in Settings against showing their empty message while rows they
 * already hold are on the way to the screen, which they did when a frame callback that empties the
 * list ran after the cached rows had been installed
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { asUser, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the lists behave the same at every size

// How long the page holds back animation frame callbacks, so the list's own frame callback runs
// after its rows are installed, an order the app leaves to timing
const FRAME_DELAY_MS = 100

const LISTS = [
  { section: 'tags', endpoint: 'tags',emptyMessage: /^No tags (yet|match your search)\.$/ },
  { section: 'merchants', endpoint: 'merchants',emptyMessage: /^No merchants (yet|match your search)\.$/ },
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

    // The patched frame timing has to be in force, or the test would pass for any ordering
    const lateBy = await page.evaluate(async () => {
      const startedAt = performance.now()
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      return performance.now() - startedAt
    })
    expect(lateBy).toBeGreaterThanOrEqual(FRAME_DELAY_MS)

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
  await search.fill(alpha)
  await expect(row(alpha)).toBeVisible()
  await letDelayedFramesRun(page)

  expect(await page.evaluate(() => (window as unknown as { emptyMessageShown: boolean }).emptyMessageShown)).toBe(false)
  await expect(row(alpha)).toBeVisible()
  await expect(row(beta)).toHaveCount(0)
})
