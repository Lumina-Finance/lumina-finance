import { expect, test } from '@playwright/test'

import { expectSignedIn, logIn } from '../support/app'
import { CARDS, PATHS, card, createExpenseInApp, expectContained, expectGeometry, expectLoaded, matchesApi, navigate, seedRichInsights } from '../support/insights'

for (const longDetail of [false, true]) {
  test(`insights same-key failed refetch replaces cached data and preserves recovery geometry (${longDetail ? 'long' : 'ordinary'} detail)`, async ({ page, request }) => {
    const rich = await seedRichInsights(request)
    const successful = new Set<string>()
    const firstUrls = new Map<string, string>()
    const attempts = new Map<string, number>()
    const failures = new Set<string>()
    let failRefetch = false
    const detail = longDetail
      ? Array.from({ length: 60 }, () => 'The synthetic insights request could not be completed and the existing account data remains unchanged').join(' ')
      : 'The synthetic insights request could not be completed'
    await page.route((url) => PATHS.some((path) => matchesApi(url.href, path)), async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const path = PATHS.find((candidate) => matchesApi(route.request().url(), candidate))!
      attempts.set(path, (attempts.get(path) ?? 0) + 1)
      if (failRefetch) {
        expect(route.request().url()).toBe(firstUrls.get(path))
        failures.add(path)
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail }) })
      } else {
        const response = await route.fetch()
        expect(response.ok()).toBe(true)
        firstUrls.set(path, route.request().url())
        successful.add(path)
        await route.fulfill({ response })
      }
    })
    await logIn(page, rich.user)
    await expectSignedIn(page)
    await navigate(page, 'Insights')
    await expectLoaded(page, successful)
    await expect(card(page, 3).getByRole('img', { name: 'Merchant market map', exact: true })).toBeVisible()
    await expect(card(page, 4).getByText(/^Insights \d long descriptive merchant/)).toHaveCount(8)
    const before = await expectGeometry(page)
    expect(new URL(firstUrls.get('/insights/savings-rate-trend')!).search).toBe('')
    await navigate(page, 'Transactions')
    await createExpenseInApp(page, rich.account.name)
    failRefetch = true
    await navigate(page, 'Insights')
    for (let index = 0; index < CARDS.length; index += 1) {
      const widget = card(page, index)
      await widget.scrollIntoViewIfNeeded()
      const heading = widget.getByRole('heading', { name: `${CARDS[index].subject} could not load`, exact: true })
      await expect(heading).toBeVisible()
      await expect(widget.getByRole('alert')).toContainText(detail)
      await expect(widget.getByRole('status', { name: CARDS[index].loading, exact: true })).toHaveCount(0)
      await expectContained(heading, widget)
      await expectContained(widget.getByRole('button', { name: 'Reload', exact: true }), widget)
      await expectContained(widget.getByRole('button', { name: 'Copy error details', exact: true }), widget)
      if (index === 0) await expect(widget.getByRole('button', { name: 'Ending Net Worth calculation', exact: true })).toHaveCount(0)
      if (index === 1) await expect(widget.getByRole('button', { name: 'Net Cash Flow calculation', exact: true })).toHaveCount(0)
      if (index === 2) await expect(widget.getByRole('button', { name: 'Latest Savings Rate calculation', exact: true })).toHaveCount(0)
      if (index === 3) await expect(widget.getByRole('img', { name: 'Merchant market map', exact: true })).toHaveCount(0)
      if (index === 4) await expect(widget.getByText(/^Insights \d long descriptive merchant/)).toHaveCount(0)
    }
    const after = await expectGeometry(page)
    for (let index = 0; index < after.length; index += 1) {
      if (after[index] !== null) expect(Math.abs(after[index]! - before[index]!)).toBeLessThanOrEqual(1)
    }
    expect([...failures].sort()).toEqual([...PATHS].sort())
    for (const path of PATHS) expect(attempts.get(path)).toBeGreaterThanOrEqual(2)
  })
}
