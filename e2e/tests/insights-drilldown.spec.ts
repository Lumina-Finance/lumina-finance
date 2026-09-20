import { expect, test, type APIRequestContext, type Locator, type Page, type Route } from '@playwright/test'
import { createAccount, findReferenceId, signUpUser, TEST_CURRENCY, type TestUser } from '../support/api'
import { openPage, expectSignedIn, logIn, waitForPageReady } from '../support/app'
import { API_BASE_URL } from '../support/target'

const NOW = new Date('2026-04-15T16:00:00Z')
const FROM = '2026-04-01'
const TO = '2026-04-15'

/** Creates real category/date boundaries and a crossover category beyond the five ordinary legend rows */
async function createDrillFixture(request: APIRequestContext) {
  const user = await signUpUser(request)
  const headers = { Authorization: `Bearer ${user.accessToken}` }
  const account = await createAccount(request, user, { name: 'Chart drill account' })
  const categories: { id: string; name: string }[] = []
  for (let index = 0; index < 7; index++) {
    const name = `Drill category ${index}`
    const response = await request.post(`${API_BASE_URL}/categories`, { headers, data: { name, kind: index === 6 ? 'income' : 'expense' } })
    expect(response.status()).toBe(201)
    categories.push(await response.json() as { id: string; name: string })
  }
  const merchantId = await findReferenceId(request, user, 'merchants', 'Unknown')
  const allIds: string[] = []
  /** Records a synthetic transaction without replacing the real application or API behavior */
  async function record(category: number, amount: number, dt: string, accountId = account.id) {
    const response = await request.post(`${API_BASE_URL}/transactions`, {
      headers, data: { account_id: accountId, category_id: categories[category].id, merchant_id: merchantId, amount, dt, currency: TEST_CURRENCY },
    })
    expect(response.status()).toBe(201)
    const { id } = await response.json() as { id: string }
    allIds.push(id)
    return id
  }
  const selected = [await record(0, -50000, FROM), await record(0, -40000, TO), await record(0, 100, '2026-04-07')]
  await record(0, -3000, '2026-03-31')
  await record(0, -3000, '2026-04-16')
  const otherIds: string[] = []
  for (let index = 1; index < 7; index++) otherIds.push(await record(index, -10000 + index * 1000, '2026-04-05'))
  const readOnlyAccount = await createAccount(request, user, { name: 'Archived chart drill account' })
  const readOnlyId = await record(0, -101, '2026-04-02', readOnlyAccount.id)
  selected.push(readOnlyId)
  const archived = await request.patch(`${API_BASE_URL}/accounts/${readOnlyAccount.id}`, { headers, data: { is_archived: true } })
  expect(archived.status()).toBe(200)
  const unfiltered = await request.get(`${API_BASE_URL}/transactions`, { headers })
  expect(unfiltered.status()).toBe(200)
  const unfilteredIds = (await unfiltered.json() as { id: string }[]).map((transaction) => transaction.id)
  return { user, categories, selected, otherIds, readOnlyId, account, allIds, unfilteredIds }
}

/** Signs in once and fixes Date without replacing performance, animation frames, or the native animation timeline */
async function start(page: Page, user: TestUser) {
  await page.addInitScript(({ now }) => {
    const NativeDate = Date
    const fixedNow = () => now
    window.Date = new Proxy(NativeDate, {
      construct(target, args, newTarget) {
        return Reflect.construct(target, args.length === 0 ? [now] : args, newTarget)
      },
      apply() {
        return new NativeDate(now).toString()
      },
      get(target, property, receiver) {
        return property === 'now' ? fixedNow : Reflect.get(target, property, receiver)
      },
    })
  }, { now: NOW.getTime() })
  await logIn(page, user)
  await expectSignedIn(page)
}

/** Waits for actual rendered transaction identities instead of treating an old loading snapshot as final */
async function expectRows(page: Page, ids: string[]) {
  // A history change updates the URL before the outgoing route becomes busy
  await page.getByRole('main').getByRole('heading', { name: 'Transactions', exact: true }).waitFor()
  await waitForPageReady(page)
  await expect.poll(() => page.getByTestId(/^transaction-row-/).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid')!.replace('transaction-row-', '')).sort())).toEqual([...ids].sort())
}

/** Finds the real breakdown card through its uniquely named calculation button */
function breakdown(page: Page) {
  return page.locator('section.app-card').filter({ has: page.getByRole('button', { name: 'Expense Breakdown calculation', exact: true }) })
}

/** Brings the lazy-loaded card into view so its real visibility-gated query can run */
async function showBreakdown(page: Page) {
  const card = breakdown(page)
  await card.waitFor({ state: 'visible' })
  await waitForPageReady(page)
  await card.scrollIntoViewIfNeeded()
  return card
}

/** Waits for the library's settled geometry before interacting with a sector that can keep focus */
async function expectSectorReady(sector: Locator) {
  await expect(sector).toBeVisible()
  await expect(sector).toHaveAttribute('aria-disabled', 'false')
  await expect(sector).toHaveAttribute('tabindex', '0')
}

/** Records the first rendered action state without changing chart, focus, or animation behavior */
async function observeInitialSector(page: Page, label: string) {
  await page.addInitScript(({ label }) => {
    const measurement = { first: null as { disabled: string | null; tabIndex: string | null } | null }
    const observedWindow = window as Window & { __breakdownFirstAction?: typeof measurement }
    observedWindow.__breakdownFirstAction = measurement
    new MutationObserver(() => {
      if (measurement.first) return
      const action = Array.from(document.querySelectorAll('g.app-breakdown-sector')).find((element) => element.getAttribute('aria-label') === label)
      if (action) measurement.first = { disabled: action.getAttribute('aria-disabled'), tabIndex: action.getAttribute('tabindex') }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-disabled', 'tabindex'] })
  }, { label })
}

/** Hovers a point inside the real filled SVG sector rather than the donut hole in its bounding box */
async function hoverSector(page: Page, sector: Locator, categoryName: string) {
  const path = sector.locator('path')
  const insidePoint = () => path.evaluate((element) => {
    const shape = element as SVGGeometryElement
    const bounds = shape.getBBox()
    const transform = shape.getScreenCTM()
    const action = shape.closest('.app-breakdown-sector')
    if (!transform) return null
    for (let row = 1; row < 20; row++) {
      for (let column = 1; column < 20; column++) {
        const point = new DOMPoint(bounds.x + bounds.width * column / 20, bounds.y + bounds.height * row / 20)
        if (shape.isPointInFill(point)) {
          const screen = point.matrixTransform(transform)
          if (screen.x < 0 || screen.y < 0 || screen.x >= window.innerWidth || screen.y >= window.innerHeight) continue
          if (document.elementFromPoint(screen.x, screen.y)?.closest('.app-breakdown-sector') !== action) continue
          return { x: screen.x, y: screen.y }
        }
      }
    }
    return null
  })
  await sector.scrollIntoViewIfNeeded()
  await expect.poll(insidePoint).not.toBeNull()
  const point = await insidePoint()
  expect(point).not.toBeNull()
  await page.mouse.move(point!.x, point!.y)
  await expect(page.locator('.app-chart-tooltip-default-content').filter({ has: page.getByText(categoryName, { exact: true }) })).toBeVisible()
  return point!
}

/** Activates a real sector after its hover tooltip has updated */
async function clickSector(page: Page, sector: Locator, categoryName: string) {
  const point = await hoverSector(page, sector, categoryName)
  await page.mouse.click(point.x, point.y)
}

/** Keeps an enabled action's DOM identity and focus when focusing it scrolls the chart into view */
async function focusOffscreenSector(page: Page, sector: Locator) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => sector.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.top >= window.innerHeight || rect.bottom <= 0
  })).toBe(true)
  await expectSectorReady(sector)
  const original = await sector.elementHandle()
  expect(original).not.toBeNull()
  try {
    await sector.focus()
    await expect(sector).toBeFocused()
    await expect.poll(() => original!.evaluate((element) => element.isConnected)).toBe(true)
    expect(await original!.evaluate((element) => document.activeElement === element)).toBe(true)
  } finally {
    await original?.dispose()
  }
}

/** Opens the responsive filter surface, using the compact tablet rail to avoid existing sidebar overlap */
async function openFilters(page: Page) {
  const mobile = page.viewportSize()!.width < 750
  const trigger = page.getByRole('button', { name: mobile ? /^Filters/ : 'Transaction filters', exact: !mobile })
  if (page.viewportSize()!.width === 1194) {
    const nav = page.getByRole('navigation', { name: 'Primary', exact: true })
    const collapse = nav.getByRole('button', { name: 'Collapse sidebar', exact: true })
    if (await collapse.isVisible()) await collapse.click()
    await trigger.focus()
    await page.mouse.move(1184, 10)
    await expect(nav).toHaveClass(/app-desktop-nav-collapsed/)
  }
  await trigger.click()
  const panel = mobile ? page.getByRole('dialog', { name: 'Transaction filters', exact: true }) : page.locator('.app-range-glass').filter({ has: page.getByRole('button', { name: 'Transaction filters', exact: true }) })
  await expect(panel.getByRole('button', { name: 'Apply filters', exact: true })).toBeVisible()
  return panel
}

/** Chooses the requested facet through the actual responsive control */
async function selectFacet(page: Page, panel: Locator, name: string) {
  const facetName = new RegExp(`^${name}(?: \\d+)?$`)
  if (page.viewportSize()!.width < 750) {
    await panel.getByRole('combobox', { name: 'Filters', exact: true }).click()
    await panel.getByRole('option', { name: facetName }).click()
  } else await panel.getByRole('tab', { name: facetName }).click()
}

/** Checks the entire drill-down address, including the absence of a sign-mode restriction */
async function expectDrillUrl(page: Page, ids: string[], from = FROM, to = TO) {
  await expect.poll(() => {
    const url = new URL(page.url())
    return { path: url.pathname, categories: url.searchParams.getAll('category_id'), from: url.searchParams.get('from_date'), to: url.searchParams.get('to_date'), keys: [...url.searchParams.keys()].sort() }
  }).toEqual({ path: '/transactions', categories: ids, from, to, keys: [...ids.map(() => 'category_id'), 'from_date', 'to_date'].sort() })
}

test('opens slice transactions with inclusive dates and preserves refresh, filter and history behavior', async ({ page, request }) => {
  const fixture = await createDrillFixture(request)
  await observeInitialSector(page, `View ${fixture.categories[0].name} transactions`)
  await start(page, fixture.user)
  await openPage(page, '/insights')
  const card = await showBreakdown(page)
  const slice = card.getByRole('button', { name: `View ${fixture.categories[0].name} transactions`, exact: true })
  await expectSectorReady(slice)
  expect(await page.evaluate(() => (window as Window & { __breakdownFirstAction?: { first: unknown } }).__breakdownFirstAction?.first)).toEqual({ disabled: 'true', tabIndex: '-1' })
  await clickSector(page, slice, fixture.categories[0].name)
  await expectDrillUrl(page, [fixture.categories[0].id])
  await expectRows(page, fixture.selected)
  await expect(page.getByTestId(`transaction-row-${fixture.readOnlyId}`)).toContainText('Archived')
  await page.reload()
  await expectDrillUrl(page, [fixture.categories[0].id])
  await expectRows(page, fixture.selected)

  let panel = await openFilters(page)
  await selectFacet(page, panel, 'Category')
  await panel.getByRole('checkbox', { name: fixture.categories[1].name, exact: true }).click()
  await panel.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expectDrillUrl(page, [fixture.categories[0].id, fixture.categories[1].id])
  await expectRows(page, [...fixture.selected, fixture.otherIds[0]])
  panel = await openFilters(page)
  await panel.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect.poll(() => new URL(page.url()).search).toBe('')
  await page.goBack()
  await expectDrillUrl(page, [fixture.categories[0].id, fixture.categories[1].id])
  await expectRows(page, [...fixture.selected, fixture.otherIds[0]])
  await page.goBack()
  await expectDrillUrl(page, [fixture.categories[0].id])
  await expectRows(page, fixture.selected)
  await page.goForward()
  await expectDrillUrl(page, [fixture.categories[0].id, fixture.categories[1].id])
  await expectRows(page, [...fixture.selected, fixture.otherIds[0]])
  panel = await openFilters(page)
  await panel.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect.poll(() => new URL(page.url()).search).toBe('')
  await expectRows(page, fixture.unfilteredIds)
})

test('validates initial URL filters and keeps local-only changes out of address history', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const fixture = await createDrillFixture(request)
  await start(page, fixture.user)
  const listQueries: URLSearchParams[] = []
  page.on('request', (req) => {
    const url = new URL(req.url())
    const api = new URL(`${API_BASE_URL}/transactions`)
    if (req.method() === 'GET' && url.origin === api.origin && url.pathname === api.pathname) listQueries.push(url.searchParams)
  })
  const id = fixture.categories[0].id
  await openPage(page, `/transactions?category_id=junk&category_id=${id}&category_id=${id.toUpperCase()}&from_date=2026-02-30&to_date=${TO}&context=one&context=two`)
  await expectRows(page, [...fixture.selected, fixture.allIds[3]])
  expect(listQueries.length).toBeGreaterThan(0)
  expect(listQueries[0].getAll('category_id')).toEqual([id])
  expect(listQueries[0].has('from_date')).toBe(false)
  expect(listQueries[0].get('to_date')).toBe(TO)
  const historyLength = await page.evaluate(() => history.length)
  const address = page.url()
  let panel = await openFilters(page)
  await panel.getByRole('checkbox', { name: fixture.account.name, exact: true }).click()
  await panel.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expectRows(page, [...fixture.selected.filter((row) => row !== fixture.readOnlyId), fixture.allIds[3]])
  // The first write canonicalizes malformed owned fields; another local-only change must not push
  expect(new URL(page.url()).searchParams.getAll('context')).toEqual(['one', 'two'])
  const canonicalLength = await page.evaluate(() => history.length)
  expect(canonicalLength).toBe(historyLength + (page.url() === address ? 0 : 1))
  panel = await openFilters(page)
  await panel.getByRole('checkbox', { name: fixture.account.name, exact: true }).click()
  await panel.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expectRows(page, [...fixture.selected, fixture.allIds[3]])
  expect(await page.evaluate(() => history.length)).toBe(canonicalLength)
  panel = await openFilters(page)
  await panel.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect.poll(() => Array.from(new URL(page.url()).searchParams)).toEqual([['context', 'one'], ['context', 'two']])
  await expectRows(page, fixture.unfilteredIds)
  await openPage(page, `/transactions?category_id=${id}&from_date=${TO}&to_date=${FROM}`)
  await expectRows(page, [...fixture.selected, fixture.allIds[3], fixture.allIds[4]])
})

test('allows keyboard access beyond the legend and retains the displayed range during a pending change', async ({ page, request }) => {
  const fixture = await createDrillFixture(request)
  await start(page, fixture.user)
  await openPage(page, '/insights')
  let card = await showBreakdown(page)
  const beyondLegend = card.getByRole('button', { name: `View ${fixture.categories[5].name} transactions`, exact: true })
  await expectSectorReady(beyondLegend)
  await focusOffscreenSector(page, card.getByRole('button', { name: `View ${fixture.categories[0].name} transactions`, exact: true }))
  for (let index = 0; index < 5; index++) await page.keyboard.press('Tab')
  await expect(beyondLegend).toBeFocused()
  await expect.poll(() => beyondLegend.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid')
  const focusedSector = await beyondLegend.elementHandle()
  expect(focusedSector).not.toBeNull()
  try {
    await hoverSector(page, beyondLegend, fixture.categories[5].name)
    expect(await focusedSector!.evaluate((element) => element.isConnected)).toBe(true)
    await expect(beyondLegend).toBeFocused()
    expect(await focusedSector!.evaluate((element) => document.activeElement === element)).toBe(true)
    await beyondLegend.press('Enter')
  } finally {
    await focusedSector?.dispose()
  }
  await expectDrillUrl(page, [fixture.categories[5].id])
  await expectRows(page, [fixture.otherIds[4]])
  await page.goBack()
  card = await showBreakdown(page)
  const crossover = card.getByRole('button', { name: `View ${fixture.categories[6].name} transactions`, exact: true })
  await expectSectorReady(crossover)
  await crossover.focus()
  await crossover.press('Space')
  await expectDrillUrl(page, [fixture.categories[6].id])
  await expectRows(page, [fixture.otherIds[5]])
  await page.goBack()
  card = await showBreakdown(page)
  const current = card.getByRole('button', { name: `View ${fixture.categories[0].name} transactions`, exact: true })
  await expectSectorReady(current)

  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  let intercepted = false
  let markFinished!: () => void
  const finished = new Promise<void>((resolve) => { markFinished = resolve })
  /** Holds only this synthetic user's next dated breakdown request */
  const handler = async (route: Route) => {
    const params = new URL(route.request().url()).searchParams
    if (params.get('from_date') !== '2026-03-01' || params.get('to_date') !== '2026-03-31') return route.continue()
    intercepted = true
    try {
      await held
      await route.continue()
    } finally {
      markFinished()
    }
  }
  const pattern = `${API_BASE_URL}/insights/income-expense-breakdown?*`
  await page.route(pattern, handler)
  try {
    await page.getByRole('button', { name: /^Insights date range:/ }).filter({ visible: true }).click()
    await page.getByRole('tablist', { name: 'Insights date range', exact: true }).filter({ visible: true }).getByRole('tab', { name: 'LM', exact: true }).click()
    await expect.poll(() => intercepted).toBe(true)
    await current.focus()
    await current.press('Enter')
    await expectDrillUrl(page, [fixture.categories[0].id])
    await expectRows(page, fixture.selected)
  } finally {
    release()
    if (intercepted) await finished
    await page.unroute(pattern, handler)
  }

  await page.goBack()
  await page.getByRole('button', { name: /^Insights date range:/ }).filter({ visible: true }).click()
  await page.getByRole('tablist', { name: 'Insights date range', exact: true }).filter({ visible: true }).getByRole('tab', { name: 'LM', exact: true }).click()
  card = await showBreakdown(page)
  await expect(card.getByRole('status', { name: 'Loading income and expense breakdown', exact: true })).toBeHidden()
  await expect(card.getByRole('button', { name: /^View Drill category .* transactions$/ })).toHaveCount(1)
  await expectSectorReady(card.getByRole('button', { name: `View ${fixture.categories[0].name} transactions`, exact: true }))
  await card.getByRole('button', { name: `View ${fixture.categories[0].name} transactions`, exact: true }).focus()
  await card.getByRole('button', { name: `View ${fixture.categories[0].name} transactions`, exact: true }).press('Enter')
  await expectDrillUrl(page, [fixture.categories[0].id], '2026-03-01', '2026-03-31')
  await expectRows(page, [fixture.allIds[3]])
})
