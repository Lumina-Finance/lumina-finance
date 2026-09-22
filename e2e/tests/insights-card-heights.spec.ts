import { expect, test } from '@playwright/test'

import { signUpUser, TEST_TIMEZONE } from '../support/api'
import { expectSignedIn, logIn } from '../support/app'
import { CARDS, PATHS, card, expectGeometry, expectLoaded, matchesApi, navigate, seedRichInsights } from '../support/insights'
import { BASE_URL } from '../support/target'

const BOUNDARY_WIDTHS = [749, 750, 1299, 1300]

test('insights geometry holds across sparse, loading, rich data and exact responsive boundaries', async ({ page, browser, request }, testInfo) => {
  const sparseUser = await signUpUser(request)
  const rich = await seedRichInsights(request)
  const sparseContext = await browser.newContext({
    baseURL: BASE_URL, viewport: page.viewportSize(), locale: 'en-CA', timezoneId: TEST_TIMEZONE,
    isMobile: testInfo.project.name !== 'desktop', hasTouch: testInfo.project.name !== 'desktop',
  })
  let release = () => {}
  try {
    const sparse = await sparseContext.newPage()
    const sparseSuccess = new Set<string>()
    sparse.on('response', (response) => {
      const path = PATHS.find((candidate) => matchesApi(response.url(), candidate))
      if (path && response.ok()) sparseSuccess.add(path)
    })
    await logIn(sparse, sparseUser)
    await expectSignedIn(sparse)
    await navigate(sparse, 'Insights')
    await expectLoaded(sparse, sparseSuccess)
    await expect(card(sparse, 1).getByText('No cash flow in this range', { exact: true })).toBeVisible()
    await expect(card(sparse, 4).getByText('No merchant spending in this range', { exact: true })).toBeVisible()
    const widths = [...new Set([page.viewportSize()!.width, ...BOUNDARY_WIDTHS])]
    const sparseVectors = new Map<number, (number | null)[]>()
    for (const width of widths) {
      await sparse.setViewportSize({ width, height: page.viewportSize()!.height })
      sparseVectors.set(width, await expectGeometry(sparse))
    }
    const gate = new Promise<void>((resolve) => { release = resolve })
    const richSuccess = new Set<string>()
    await page.route((url) => PATHS.some((path) => matchesApi(url.href, path)), async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const path = PATHS.find((candidate) => matchesApi(route.request().url(), candidate))!
      expect(response.ok()).toBe(true)
      await gate
      richSuccess.add(path)
      await route.fulfill({ response })
    })
    await logIn(page, rich.user)
    await expectSignedIn(page)
    await navigate(page, 'Insights')
    for (let index = 0; index < CARDS.length; index += 1) {
      await card(page, index).scrollIntoViewIfNeeded()
      await expect(card(page, index).getByRole('status', { name: CARDS[index].loading, exact: true })).toBeVisible()
    }
    const loading = await expectGeometry(page)
    const initialSparse = sparseVectors.get(page.viewportSize()!.width)!
    for (let index = 0; index < loading.length; index += 1) {
      if (loading[index] !== null) expect(Math.abs(loading[index]! - initialSparse[index]!)).toBeLessThanOrEqual(1)
    }
    release()
    await expectLoaded(page, richSuccess)
    await expect(card(page, 3).getByRole('img', { name: 'Merchant market map', exact: true })).toBeVisible()
    await expect(card(page, 4).getByText(/^Insights \d long descriptive merchant/)).toHaveCount(8)
    for (const width of widths) {
      await page.setViewportSize({ width, height: page.viewportSize()!.height })
      const richVector = await expectGeometry(page)
      const sparseVector = sparseVectors.get(width)!
      for (let index = 0; index < richVector.length; index += 1) {
        if (richVector[index] !== null) expect(Math.abs(richVector[index]! - sparseVector[index]!)).toBeLessThanOrEqual(1)
      }
      if (width < 1300) {
        const richHeight = (await card(page, 4).boundingBox())!.height
        await sparse.setViewportSize({ width, height: page.viewportSize()!.height })
        expect(richHeight).toBeGreaterThan((await card(sparse, 4).boundingBox())!.height)
      }
    }
  } finally {
    release()
    await sparseContext.close()
  }
})
