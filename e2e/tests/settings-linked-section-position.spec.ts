/**
 * Guards a link to a Settings section against landing short: the sections above it fill with their
 * data after the page opens and grow. That used to push the linked section down from where the one
 * scroll to it had aimed. Also guards the correction against fighting a reader who scrolls meanwhile
 */
import { expect, test, type Page } from '@playwright/test'

import { asUser, createAccount, createCategory, createTaxAdvantagedCategory, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage, SAVED_QUERY_CACHE_KEY } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: it sets the two widths it checks itself, 1280px with the section list beside the
// page and 390px with the section menu pinned at the top

const WIDE = { width: 1280, height: 800 }
const PHONE = { width: 390, height: 844 }

// How far from the top the heading may sit beside the pinned section menu, as the page leaves a gap
// of 16px under the menu and 32px from the top of the window beside the side list
const GAP_TOLERANCE_PX = 48

// The reads the page makes as it opens to fill the sections above and below the links
const HELD_READS = new Set([
  '/accounts',
  '/categories',
  '/merchants',
  '/tags',
  '/tax-advantaged-categories',
  '/auth/oidc/identities',
])

async function seedSections(request: Parameters<typeof signUpUser>[0], user: TestUser): Promise<void> {
  for (let index = 1; index <= 12; index += 1) {
    await createCategory(request, user, { name: `Category ${index}` })
    const merchant = await request.post(`${API_BASE_URL}/merchants`, { headers: asUser(user), data: { name: `Merchant ${index}` } })
    expect(merchant.status()).toBe(201)
    const tag = await request.post(`${API_BASE_URL}/tags`, { headers: asUser(user), data: { name: `Tag ${index}` } })
    expect(tag.status()).toBe(201)
  }
  for (const name of ['Everyday', 'Savings', 'Travel']) await createAccount(request, user, { name })
  for (const name of ['Retirement', 'Education', 'Home']) await createTaxAdvantagedCategory(request, user, name)
}

/**
 * Holds back the reads that fill the sections, so the page opens before they land, and drops the
 * cache the browser saved so the page cannot draw them from it
 *
 * @returns A function that lets the held reads through
 */
async function holdSectionReads(page: Page): Promise<() => void> {
  await page.addInitScript((key) => localStorage.removeItem(key), SAVED_QUERY_CACHE_KEY)
  let letThrough!: () => void
  const letThroughAfter = new Promise<void>((resolve) => {
    letThrough = resolve
  })
  const apiPrefix = new URL(API_BASE_URL).pathname
  await page.route(
    (url) => url.href.startsWith(API_BASE_URL) && HELD_READS.has(url.pathname.slice(apiPrefix.length)),
    async (route) => {
      if (route.request().method() === 'GET') await letThroughAfter
      return route.continue()
    },
  )
  return letThrough
}

/** Resolves once the page has stopped scrolling, since a link's smooth scroll takes a moment to end */
async function waitForScrollToEnd(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    let last = window.scrollY
    let steadyFrames = 0
    const check = () => {
      steadyFrames = window.scrollY === last ? steadyFrames + 1 : 0
      last = window.scrollY
      if (steadyFrames >= 10) resolve()
      else requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  }))
}

/**
 * Where the section's top sits below what stays pinned above it, in pixels, and how much further the
 * page can scroll, since the last section has too little below it to reach the top
 */
async function placeOf(page: Page, id: string): Promise<{ topBelowPinned: number; scrollLeft: number }> {
  return page.evaluate((sectionId) => {
    // The section menu's button is the pinned part, and the wider layout hides it for the side list
    const menuButton = document.querySelector('button[aria-controls="settings-mobile-section-menu"]')
    const pinnedBottom = menuButton && menuButton.getBoundingClientRect().height > 0 ? menuButton.getBoundingClientRect().bottom : 0
    const section = document.getElementById(sectionId)
    if (!section) throw new Error(`no section ${sectionId}`)
    return {
      topBelowPinned: section.getBoundingClientRect().top - pinnedBottom,
      scrollLeft: document.documentElement.scrollHeight - window.innerHeight - window.scrollY,
    }
  }, id)
}

/** The section sits just below what stays pinned, or as near as the end of the page lets it */
async function expectAtTop(page: Page, id: string): Promise<void> {
  await expect.poll(async () => {
    const { topBelowPinned, scrollLeft } = await placeOf(page, id)
    return topBelowPinned >= 0 && (topBelowPinned <= GAP_TOLERANCE_PX || scrollLeft <= 1)
  }, { message: `${id} sits at the top once the page has settled` }).toBe(true)
}

const LINKS = [
  { name: 'tags on a computer', id: 'tags', size: WIDE },
  // Tags rather than Merchants for the phone, since only the lists the page draws late grow it, and
  // none of them sits above Merchants
  { name: 'tags on a phone', id: 'tags', size: PHONE },
  { name: 'tax-advantaged categories on a computer', id: 'tax-advantaged-categories', size: WIDE },
]

/** Resolves once the merchants, tags and tax-advantaged lists have drawn their rows */
async function expectListsLoaded(page: Page): Promise<void> {
  await expect(page.locator('#merchants')).toContainText('Merchant 12')
  await expect(page.locator('#tags')).toContainText('Tag 12')
  await expect(page.locator('#tax-advantaged-categories')).toContainText('Home')
}

/** How far down the page a section starts, so a section pushed down by growth above it reads larger */
const depthInPage = (page: Page, id: string) =>
  page.evaluate((sectionId) => {
    const section = document.getElementById(sectionId)
    if (!section) throw new Error(`no section ${sectionId}`)
    return section.getBoundingClientRect().top + window.scrollY
  }, id)

for (const { name, id, size } of LINKS) {
  test(`leaves a link to ${name} at the top once the sections above it have loaded`, async ({ page, request }) => {
    const user = await signUpUser(request)
    await seedSections(request, user)
    await page.setViewportSize(size)
    await logInViaApi(page, user)
    const letReadsThrough = await holdSectionReads(page)

    await openPage(page, `/settings#${id}`)
    // The reads are held back, so the sections above have yet to grow
    await expect(page.locator('#tags')).not.toContainText('Tag 12')
    const depthBeforeLoading = await depthInPage(page, id)

    letReadsThrough()
    await expectListsLoaded(page)
    await expect.poll(() => depthInPage(page, id), { message: 'the sections above pushed it down' })
      .toBeGreaterThan(depthBeforeLoading)
    await expectAtTop(page, id)
    // The pinned section menu on a phone names the section the page is at
    if (size === PHONE) {
      await expect(page.locator('button[aria-controls="settings-mobile-section-menu"]')).toHaveText('Tags')
    }
  })
}

test('lets a reader who scrolls while the page loads stay where they scrolled to', async ({ page, request }) => {
  const user = await signUpUser(request)
  await seedSections(request, user)
  await page.setViewportSize(WIDE)
  await logInViaApi(page, user)
  const letReadsThrough = await holdSectionReads(page)

  await openPage(page, '/settings#categories')
  await expect(page.locator('#tags')).not.toContainText('Tag 12')
  await expect.poll(() => page.evaluate(() => window.scrollY), { message: 'the link scrolled the page' }).toBeGreaterThan(0)
  await waitForScrollToEnd(page)

  await page.mouse.move(WIDE.width / 2, WIDE.height / 2)
  await page.mouse.wheel(0, -10_000)
  await expect.poll(() => page.evaluate(() => window.scrollY), { message: 'the reader scrolled back to the top' }).toBe(0)

  letReadsThrough()
  await expectListsLoaded(page)
  // Two frames, since a correction would run the frame after the page grew
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})
