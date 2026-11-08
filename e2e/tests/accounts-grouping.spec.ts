import { expect, test, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createTaxAdvantagedCategory, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the grouping logic and its saved choices are the same at every size. The tests
// that check a phone or a narrow width set that width themselves

const GROUPING_KEY = 'lumina:settings:accountGrouping'
const THEN_GROUPING_KEY = 'lumina:settings:accountThenGrouping'

// A one pixel image, standing in for the favicon every institution's logo is drawn from
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

type Seed = { user: TestUser; bank: string }

async function seedAccounts(
  page: Page,
  request: Parameters<typeof signUpUser>[0],
  { withTaxCategory = false }: { withTaxCategory?: boolean } = {},
): Promise<Seed> {
  const user = await signUpUser(request)
  // An institution is unique by name and country across every user, so each run names its own
  const bank = `Grouping Bank ${crypto.randomUUID()}`
  const institution = await request.post(`${API_BASE_URL}/institutions`, {
    headers: asUser(user),
    data: { name: bank, country_code: 'CA', website: 'https://example.com' },
  })
  expect(institution.status()).toBe(201)
  const { id } = (await institution.json()) as { id: string }
  const taxAdvantagedCategoryId = withTaxCategory ? await createTaxAdvantagedCategory(request, user, 'TFSA') : undefined

  await createAccount(request, user, {
    name: 'Bank savings',
    accountType: 'savings',
    startingBalance: 250_000,
    institutionId: id,
    taxAdvantagedCategoryId,
  })
  await createAccount(request, user, { name: 'Pocket cash', accountType: 'cash', startingBalance: 4_000 })
  await createAccount(request, user, {
    name: 'Store card',
    accountType: 'credit_card',
    accountKind: 'revolving',
    startingBalance: -30_000,
    creditLimit: 100_000,
  })
  await logInViaApi(page, user)
  return { user, bank }
}

// A group's heading is its whole header button, so it is found by the title it starts with
function groupHeading(page: Page, title: string) {
  return page.getByRole('heading').filter({ hasText: new RegExp(`^${title}`) })
}

function groupButton(page: Page, title: string) {
  return groupHeading(page, title).getByRole('button')
}

// An account's row is its own box, with the link on the account's name stretched over it, so a row is
// found by the name its link carries and everything the row shows is read from the row
const ACCOUNT_ROW = '[data-testid^="account-row-"]'

function accountRow(page: Page, name: RegExp) {
  return page.locator(ACCOUNT_ROW).filter({ has: page.getByRole('link', { name }) })
}

// The toolbar draws one grouping panel for the desktop row and another for the phone's, so only the
// one showing at this size counts
function groupingPill(page: Page) {
  return page.getByRole('button', { name: 'Account grouping' }).filter({ visible: true })
}

async function openPanel(page: Page) {
  await groupingPill(page).click()
  await expect(groupingPill(page)).toHaveAttribute('aria-expanded', 'true')
}

async function closePanel(page: Page) {
  await groupingPill(page).click()
  await expect(groupingPill(page)).toHaveAttribute('aria-expanded', 'false')
}

async function chooseLevel(page: Page, level: 'Group by' | 'Then by', optionName: string) {
  await page.getByRole('combobox', { name: level }).filter({ visible: true }).click()
  await page.getByRole('option', { name: optionName, exact: true }).click()
}

async function chooseFirstLevel(page: Page, optionName: string) {
  await openPanel(page)
  await chooseLevel(page, 'Group by', optionName)
}

test('groups accounts by account type, then by institution, and remembers the choice', async ({ page, request }) => {
  await seedAccounts(page, request)
  await openPage(page, '/accounts')

  // Account type is the default
  await expect(groupHeading(page, 'Savings')).toBeVisible()
  await expect(groupHeading(page, 'Credit card')).toBeVisible()

  await chooseFirstLevel(page, 'Institution')
  await expect(groupHeading(page, 'No institution')).toBeVisible()
  await expect(groupHeading(page, 'Savings')).toBeHidden()
  // Both unlinked accounts gather in the one group, the card among them
  await expect(groupHeading(page, 'No institution')).toContainText('2 accounts')

  await page.reload()
  await expect(groupHeading(page, 'No institution')).toBeVisible()
})

test('offers the two groupings, starts from the defaults and splits each group by a second level', async ({
  page,
  request,
}) => {
  const { bank } = await seedAccounts(page, request)
  await openPage(page, '/accounts')
  await openPanel(page)

  await expect(page.getByRole('combobox', { name: 'Group by' }).filter({ visible: true })).toContainText('Account type')
  await expect(page.getByRole('combobox', { name: 'Then by' }).filter({ visible: true })).toContainText('None')
  await expect(page.getByRole('switch', { name: 'Show bank logos' })).toBeChecked()
  await expect(page.getByRole('switch', { name: 'Keep groups expanded' })).toBeChecked()

  await page.getByRole('combobox', { name: 'Group by' }).filter({ visible: true }).click()
  await expect(page.getByRole('option')).toHaveText(['Institution', 'Account type'])
  await page.getByRole('option', { name: 'Account type', exact: true }).click()
  await expect(page.getByRole('option')).toHaveCount(0)

  // The second level can't repeat the first
  await page.getByRole('combobox', { name: 'Then by' }).filter({ visible: true }).click()
  await expect(page.getByRole('option')).toHaveText(['None', 'Institution'])
  await page.getByRole('option', { name: 'Institution', exact: true }).click()
  await closePanel(page)

  // The sub-group starts closed under its open group, and opens with a click
  const subGroup = groupButton(page, bank)
  await expect(groupButton(page, 'Savings')).toHaveAttribute('aria-expanded', 'true')
  await expect(subGroup).toHaveAttribute('aria-expanded', 'false')
  await subGroup.click()
  await expect(page.getByRole('link', { name: /Bank savings/ })).toBeVisible()

  await page.reload()
  await expect(groupHeading(page, bank)).toBeVisible()
  await openPanel(page)
  await expect(page.getByRole('combobox', { name: 'Then by' }).filter({ visible: true })).toContainText('Institution')
})

test('falls back to the defaults, without a message, when a saved choice is not one the page offers', async ({
  page,
  request,
}) => {
  await seedAccounts(page, request)
  await page.addInitScript(
    ([first, second]) => {
      localStorage.setItem(first, 'asset_class')
      localStorage.setItem(second, 'asset_class')
    },
    [GROUPING_KEY, THEN_GROUPING_KEY],
  )
  await openPage(page, '/accounts')

  await expect(groupHeading(page, 'Credit card')).toBeVisible()
  await expect(groupHeading(page, 'Cash')).toBeVisible()
  await openPanel(page)
  await expect(page.getByRole('combobox', { name: 'Group by' }).filter({ visible: true })).toContainText('Account type')
  await expect(page.getByRole('combobox', { name: 'Then by' }).filter({ visible: true })).toContainText('None')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('keeps a group and says so when the search matches none of its accounts', async ({ page, request }) => {
  await seedAccounts(page, request)
  await openPage(page, '/accounts')

  await page.getByPlaceholder('Search accounts...').fill('Pocket')
  const savings = page.locator('section').filter({ has: groupHeading(page, 'Savings') })
  await expect(savings.getByText('No matching accounts')).toBeVisible()
  await expect(page.getByRole('link', { name: /Pocket cash/ })).toBeVisible()
})

test('keeping groups expanded opens the top level on each visit and still lets a group close', async ({
  page,
  request,
}) => {
  const { bank } = await seedAccounts(page, request)
  await openPage(page, '/accounts')
  await openPanel(page)
  await chooseLevel(page, 'Then by', 'Institution')
  await closePanel(page)

  const savings = groupButton(page, 'Savings')
  const subGroup = groupButton(page, bank)
  await expect(savings).toHaveAttribute('aria-expanded', 'true')
  await expect(subGroup).toHaveAttribute('aria-expanded', 'false')

  // Opening a sub-group and closing a top-level group work freely during the visit
  await subGroup.click()
  await expect(subGroup).toHaveAttribute('aria-expanded', 'true')
  await groupButton(page, 'Cash').click()
  await expect(groupButton(page, 'Cash')).toHaveAttribute('aria-expanded', 'false')

  // None of it is remembered: the next visit starts from the top level open and sub-groups closed
  await page.reload()
  await expect(groupButton(page, 'Cash')).toHaveAttribute('aria-expanded', 'true')
  await expect(savings).toHaveAttribute('aria-expanded', 'true')
  await expect(subGroup).toHaveAttribute('aria-expanded', 'false')
})

test('with the groups not kept expanded, each group’s open or closed state is remembered', async ({ page, request }) => {
  await seedAccounts(page, request)
  await openPage(page, '/accounts')
  await openPanel(page)
  await page.getByText('Keep groups expanded').click()
  await expect(page.getByRole('switch', { name: 'Keep groups expanded' })).not.toBeChecked()
  await closePanel(page)

  // Every group starts closed, and the one the user opens stays open on the next visit
  await expect(groupButton(page, 'Savings')).toHaveAttribute('aria-expanded', 'false')
  await groupButton(page, 'Savings').click()
  await expect(groupButton(page, 'Savings')).toHaveAttribute('aria-expanded', 'true')

  await page.reload()
  await expect(groupButton(page, 'Savings')).toHaveAttribute('aria-expanded', 'true')
  await expect(groupButton(page, 'Cash')).toHaveAttribute('aria-expanded', 'false')

  // Closing it is remembered too, so the switch never stops a group collapsing
  await groupButton(page, 'Savings').click()
  await page.reload()
  await expect(groupButton(page, 'Savings')).toHaveAttribute('aria-expanded', 'false')

  // Turning the switch back on opens the top level again
  await openPanel(page)
  await page.getByText('Keep groups expanded').click()
  await closePanel(page)
  await expect(groupButton(page, 'Savings')).toHaveAttribute('aria-expanded', 'true')
  await expect(groupButton(page, 'Cash')).toHaveAttribute('aria-expanded', 'true')
})

test('shows bank logos on group headers, and on rows a bank header doesn’t head, until the switch hides them', async ({
  page,
  request,
}) => {
  const { bank } = await seedAccounts(page, request)
  await page.route(/gstatic\.com\/faviconV2/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }),
  )
  await openPage(page, '/accounts')
  const logos = page.getByRole('img', { name: `${bank} logo` })

  // Grouped by type, a stack of bank logos sits under the group's name and the rows keep their own
  await expect(logos).toHaveCount(2)
  await expect(groupHeading(page, 'Savings').getByRole('img', { name: `${bank} logo` })).toBeVisible()

  // Grouped by institution, the bank's logo marks the header, so its rows leave theirs out
  await chooseFirstLevel(page, 'Institution')
  await closePanel(page)
  await expect(groupHeading(page, bank).getByRole('img', { name: `${bank} logo` })).toBeVisible()
  await expect(logos).toHaveCount(1)
  // In its place each row shows its account type's icon, since no level names the type
  await expect(accountRow(page, /Bank savings/).locator('[data-account-type-mark="savings"]')).toBeVisible()
  await expect(accountRow(page, /Store card/).locator('[data-account-type-mark="credit_card"]')).toBeVisible()

  // Under a second level the sub-groups and rows still sit under their bank's header, so they leave it out
  await openPanel(page)
  await chooseLevel(page, 'Then by', 'Account type')
  await closePanel(page)
  await expect(groupHeading(page, 'Savings').getByRole('img', { name: `${bank} logo` })).toHaveCount(0)
  await groupButton(page, 'Savings').click()
  const savingsRow = accountRow(page, /Bank savings/)
  await expect(savingsRow).toBeVisible()
  await expect(savingsRow.getByRole('img', { name: `${bank} logo` })).toHaveCount(0)
  // The type sub-group's own icon names the type, so the row leaves its type mark out
  await expect(savingsRow.locator('[data-account-type-mark]')).toHaveCount(0)

  await openPanel(page)
  await page.getByText('Show bank logos').click()
  await expect(page.getByRole('switch', { name: 'Show bank logos' })).not.toBeChecked()
  await expect(logos).toHaveCount(0)

  await page.reload()
  await expect(logos).toHaveCount(0)
})

test('shows the tax-advantaged tag on a bank’s header, and hides it below 640px', async ({
  page,
  request,
}) => {
  const { bank } = await seedAccounts(page, request, { withTaxCategory: true })
  await openPage(page, '/accounts')

  // Grouped by type, the tag stays on the account's row and the group header has none
  await expect(groupHeading(page, 'Savings').getByText('TFSA')).toHaveCount(0)
  await expect(accountRow(page, /Bank savings/).getByText('TFSA')).toBeVisible()

  await chooseFirstLevel(page, 'Institution')
  await closePanel(page)
  await expect(groupHeading(page, bank).getByText('TFSA')).toBeVisible()

  await page.setViewportSize({ width: 639, height: 900 })
  await expect(groupHeading(page, bank).getByText('TFSA')).toBeHidden()
  await page.setViewportSize({ width: 640, height: 900 })
  await expect(groupHeading(page, bank).getByText('TFSA')).toBeVisible()
})

test('draws a top-level header larger than a sub-group’s and keeps account rows at their usual size', async ({ page, request }) => {
  const { bank } = await seedAccounts(page, request)
  await openPage(page, '/accounts')
  await openPanel(page)
  await chooseLevel(page, 'Then by', 'Institution')
  await closePanel(page)
  await groupButton(page, bank).click()

  const measure = (locator: ReturnType<Page['getByText']>) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element)
      return { size: style.fontSize, line: style.lineHeight, weight: style.fontWeight, family: style.fontFamily }
    })

  // A top-level header: 21/28 serif title, 14.5px count, 38px mark, 50px indent, 8px above the divider
  const savingsButton = groupButton(page, 'Savings')
  const title = await measure(savingsButton.getByText('Savings', { exact: true }))
  expect(title).toMatchObject({ size: '21px', line: '28px' })
  expect(title.family.toLowerCase()).toContain('cormorant')
  expect(await measure(savingsButton.getByText('1 account', { exact: true }))).toMatchObject({ size: '14.5px' })
  const topLevel = await savingsButton.evaluate((button) => {
    const mark = button.firstElementChild!.getBoundingClientRect()
    const body = document.getElementById(button.getAttribute('aria-controls')!)!
    return { mark: [mark.width, mark.height], indent: getComputedStyle(body.firstElementChild!).paddingLeft }
  })
  expect(topLevel).toEqual({ mark: [38, 38], indent: '50px' })

  const cashSection = await groupButton(page, 'Cash').evaluate((button) => {
    const wrapper = button.closest('section')!.parentElement!
    const style = getComputedStyle(wrapper)
    return { gap: style.marginTop, divider: style.borderTopWidth }
  })
  expect(cashSection).toEqual({ gap: '8px', divider: '1px' })

  // A sub-group and an account row keep the sizes they have on the main branch
  const subButton = groupButton(page, bank)
  expect(await measure(subButton.getByText(bank, { exact: true }))).toMatchObject({ size: '20px', line: '24px' })
  expect(await measure(subButton.getByText('1 account', { exact: true }))).toMatchObject({ size: '14px' })
  const subMark = await subButton.evaluate((button) => {
    const rect = button.firstElementChild!.getBoundingClientRect()
    const body = document.getElementById(button.getAttribute('aria-controls')!)!
    return { mark: [rect.width, rect.height], indent: getComputedStyle(body.firstElementChild!).paddingLeft }
  })
  expect(subMark).toEqual({ mark: [36, 36], indent: '48px' })

  const row = accountRow(page, /Bank savings/)
  expect(await measure(row.getByText('Bank savings', { exact: true }))).toMatchObject({
    size: '16px',
    line: '24px',
    weight: '500',
  })
})

test('on a phone, Group by sits beside Filters and Add and opens a full-screen sheet with no footer', async ({
  page,
  request,
}) => {
  await seedAccounts(page, request)
  const grouping = groupingPill(page)
  const filters = page.getByRole('button', { name: 'Filters', exact: true }).filter({ visible: true })
  const add = page.getByRole('button', { name: 'Add account' }).filter({ visible: true })

  // One row, in the order Filters, Group by, Add, with Filters and Group by sharing the free width equally
  for (const height of [667, 844]) {
    await page.setViewportSize({ width: 390, height })
    await openPage(page, '/accounts')
    const [groupingBox, filtersBox, addBox] = await Promise.all([grouping, filters, add].map((l) => l.boundingBox()))
    expect(Math.abs(groupingBox!.y - filtersBox!.y)).toBeLessThan(1)
    expect(Math.abs(groupingBox!.y - addBox!.y)).toBeLessThan(6)
    expect(filtersBox!.x).toBeLessThan(groupingBox!.x)
    expect(groupingBox!.x).toBeLessThan(addBox!.x)
    expect(Math.abs(groupingBox!.width - filtersBox!.width)).toBeLessThan(1)
    expect(addBox!.width).toBeCloseTo(addBox!.height, 0)
  }

  await grouping.click()
  const sheet = page.getByRole('dialog', { name: 'Account grouping' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'Group by', exact: true })).toBeVisible()
  await expect(sheet.getByText('Account type', { exact: true }).first()).toBeVisible()
  // The sheet slides in, so its box settles on the whole screen once the slide ends
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox()
      return box && [box.x, box.y, box.width, Math.round(box.height)]
    })
    .toEqual([0, 0, 390, 844])
  await expect(sheet.getByRole('button', { name: 'Apply filters' })).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: 'Clear all' })).toHaveCount(0)

  // A change applies as it is made, and the summary line follows it
  await sheet.getByRole('combobox', { name: 'Then by' }).click()
  await page.getByRole('option', { name: 'Institution', exact: true }).click()
  await expect(sheet.getByText('Account type, then Institution')).toBeVisible()

  await sheet.getByRole('button', { name: 'Close group by' }).click()
  await expect(sheet).toBeHidden()

  // Filters opens its own sheet, with its footer
  await filters.click()
  const filterSheet = page.getByRole('dialog', { name: /filter/i })
  await expect(filterSheet.getByRole('heading', { name: 'Filters', exact: true })).toBeVisible()
  await expect(filterSheet.getByText('No active filters')).toBeVisible()
  await expect(filterSheet.getByRole('button', { name: 'Apply filters' })).toBeVisible()
  await expect(filterSheet.getByRole('button', { name: 'Clear all' })).toBeVisible()
})

test('the open grouping panel leaves the Filters pill beside it uncovered', async ({ page, request }) => {
  await seedAccounts(page, request)
  await page.setViewportSize({ width: 768, height: 900 })
  await openPage(page, '/accounts')
  const filters = page.getByRole('button', { name: 'Account filters', exact: true })
  await openPanel(page)
  const glass = page.locator('.app-range-glass').filter({ has: groupingPill(page) })
  await expect.poll(() => glass.evaluate((node) => Math.round(node.getBoundingClientRect().height))).toBeGreaterThan(200)

  // The pair sits at the right end of the toolbar, so the 268px panel opens leftward and leaves the pill beside it clear
  const [panelBox, filtersBox] = await Promise.all([glass.boundingBox(), filters.boundingBox()])
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(filtersBox!.x)
})

test('a new user with groups not kept expanded still sees the empty message', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await page.addInitScript(() => localStorage.setItem('lumina:settings:accountKeepGroupsExpanded', 'off'))
  await openPage(page, '/accounts')
  await expect(page.getByText('No accounts yet')).toBeVisible()
})

test('the Group by and Filters pills stay at the right end of the toolbar at widths where it wraps', async ({
  page,
  request,
}) => {
  await seedAccounts(page, request)
  await openPage(page, '/accounts')
  const filters = page.getByRole('button', { name: 'Account filters', exact: true })
  for (const width of [800, 900, 1000]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(filters).toBeVisible()
    const box = await filters.boundingBox()
    // Packed to the left they would end well short of the middle of the page
    expect(box!.x + box!.width, `at ${width}px wide`).toBeGreaterThan(width / 2)
  }
})

test('the desktop panel is 268px wide and its dropdown lists open no wider than their field', async ({
  page,
  request,
}) => {
  await seedAccounts(page, request)
  await openPage(page, '/accounts')
  await openPanel(page)

  const combobox = page.getByRole('combobox', { name: 'Group by' }).filter({ visible: true })
  await expect
    .poll(() => groupingPill(page).evaluate((pill) => pill.parentElement!.getBoundingClientRect().width))
    .toBe(268)

  await combobox.click()
  const list = page.getByRole('listbox')
  await expect(list).toBeVisible()
  // The list sits inside a box that opens exactly as wide as the field, so it is never wider than the
  // field and never passes the panel's edge. Read once the opening ends
  const fieldBox = await combobox.boundingBox()
  await expect.poll(async () => (await list.boundingBox())?.width).toBeLessThanOrEqual(fieldBox!.width)
  await expect.poll(async () => (await list.boundingBox())?.width).toBeGreaterThan(fieldBox!.width - 24)
})

test('regrouping fades the headers and glides the rows over 300ms with no rolling totals, and swaps at once for reduced motion', async ({
  page,
  request,
}) => {
  await seedAccounts(page, request)
  await openPage(page, '/accounts')
  await openPanel(page)

  // One frame of the list: where each seeded row sits, how visible the header the new grouping
  // adds is, and every header's text
  type Frame = { t: number; ys: Record<string, number[]>; opacity: number | null; headers: string[] }
  type Sampled = { frames: Frame[]; before: string[]; after: string[] }

  // Follows the list on each frame while the grouping changes to the option. That change adds the named header
  async function regroupTo(optionName: string, newHeading: string): Promise<Sampled> {
    await page.getByRole('combobox', { name: 'Group by' }).filter({ visible: true }).click()
    const before = await page.getByRole('heading').allTextContents()
    await page.evaluate((title) => {
      const frames: Frame[] = []
      const target = window as unknown as { __frames: Frame[]; __start: number }
      target.__frames = frames
      target.__start = performance.now()
      const getOpacity = (element: Element | null) => {
        let opacity = 1
        for (let node = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity)
        return opacity
      }
      const tick = (t: number) => {
        const heading = [...document.querySelectorAll('h3')].find((h) => h.textContent?.startsWith(title))
        frames.push({
          t,
          ys: Object.fromEntries(
            ['Bank savings', 'Pocket cash', 'Store card'].map((name) => [
              name,
              [...document.querySelectorAll('a')]
                .filter((link) => link.textContent?.includes(name))
                .map((link) => Math.round(link.getBoundingClientRect().top)),
            ]),
          ),
          opacity: heading ? getOpacity(heading) : null,
          headers: [...document.querySelectorAll('h3')].map((h) => h.textContent ?? ''),
        })
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, newHeading)
    await page.getByRole('option', { name: optionName, exact: true }).click()
    // Sampling goes on until a full second has passed, well past the 300ms glide
    await expect
      .poll(() =>
        page.evaluate(() => {
          const target = window as unknown as { __frames: Frame[]; __start: number }
          return (target.__frames.at(-1)?.t ?? 0) - target.__start
        }),
      )
      .toBeGreaterThan(1000)
    const frames = await page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames)
    const after = await page.getByRole('heading').allTextContents()
    return { frames, before, after }
  }

  // Milliseconds from the new header first showing until it is fully opaque. The ease-out curve spends its
  // last stretch within a hair of full opacity, so only the last of it needs the threshold this close
  function getFadeTime(frames: Frame[]): number {
    const shown = frames.filter((frame) => frame.opacity !== null)
    const lastFading = shown.findLast((frame) => frame.opacity! < 0.9995)
    return lastFading ? lastFading.t - shown[0].t : 0
  }

  const moving = await regroupTo('Institution', 'No institution')
  // The new header is seen partly faded on some frame, and is fully opaque within the 300ms plus a frame or two
  expect(moving.frames.some((frame) => frame.opacity !== null && frame.opacity > 0.02 && frame.opacity < 0.98)).toBe(true)
  expect(getFadeTime(moving.frames)).toBeLessThan(500)

  // Each row that changes place passes through a place that is neither where it began nor where it ends
  const rowNames = ['Bank savings', 'Pocket cash', 'Store card']
  const moved = rowNames.filter((name) => moving.frames[0].ys[name][0] !== moving.frames.at(-1)!.ys[name][0])
  expect(moved.length).toBeGreaterThan(0)
  for (const name of moved) {
    const first = moving.frames[0].ys[name][0]
    const last = moving.frames.at(-1)!.ys[name][0]
    const between = moving.frames.flatMap((frame) => frame.ys[name]).filter((y) => y !== first && y !== last)
    expect(between.length, name).toBeGreaterThan(0)
  }

  // Every header text seen is one the old or the new grouping shows, so no total rolled through numbers
  // in between
  const known = new Set([...moving.before, ...moving.after])
  for (const frame of moving.frames) {
    for (const header of frame.headers) expect(known).toContain(header)
  }

  // With reduced motion the new header is fully shown from its first frame
  // The page reads the preference as it loads, so it is set and the page reloaded, and the saved grouping stays
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await expect(groupHeading(page, 'No institution')).toBeVisible()
  await openPanel(page)
  const swapped = await regroupTo('Account type', 'Savings')
  expect(getFadeTime(swapped.frames)).toBeLessThan(100)
})

for (const phone of [false, true]) {
  test(`Escape closes the open Then by list at any moment after opening it, ${phone ? 'in the phone sheet' : 'in the desktop panel'}`, async ({
    page,
    request,
  }) => {
    await seedAccounts(page, request)
    if (phone) await page.setViewportSize({ width: 390, height: 844 })
    await openPage(page, '/accounts')
    await groupingPill(page).click()
    const container = phone ? page.getByRole('dialog', { name: 'Account grouping' }) : groupingPill(page)
    await expect(container).toBeVisible()
    const field = page.getByRole('combobox', { name: 'Then by' }).filter({ visible: true })
    await expect(field).toBeVisible()
    // The panel's own opening motion has to end before a list can be opened in it
    await page.waitForTimeout(700)

    for (const delay of [0, 0, 0, 0, 30, 100, 300]) {
      await field.click()
      await page.waitForTimeout(delay)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('listbox'), `Escape ${delay}ms after opening`).toHaveCount(0, { timeout: 2_000 })
      // One press closes one layer, so the panel or sheet is still there
      if (phone) await expect(container).toBeVisible()
      else await expect(groupingPill(page)).toHaveAttribute('aria-expanded', 'true')
    }
  })
}

test('on a phone, the Group by sheet has 44px close and switch targets and fields as tall as the Filters sheet’s', async ({
  page,
  request,
}) => {
  await seedAccounts(page, request)
  await page.setViewportSize({ width: 390, height: 844 })
  await openPage(page, '/accounts')

  await page.getByRole('button', { name: 'Filters', exact: true }).filter({ visible: true }).click()
  const filterSheet = page.getByRole('dialog', { name: /filter/i })
  await expect(filterSheet).toBeVisible()
  const filterField = await filterSheet.getByRole('combobox').first().boundingBox()
  await filterSheet.getByRole('button', { name: 'Close filters' }).click()
  await expect(filterSheet).toBeHidden()

  await groupingPill(page).click()
  const sheet = page.getByRole('dialog', { name: 'Account grouping' })
  await expect(sheet).toBeVisible()
  const heightOf = async (locator: Locator) => Math.round((await locator.boundingBox())!.height)

  expect(await heightOf(sheet.getByRole('button', { name: 'Close group by' }))).toBe(44)
  expect(await heightOf(sheet.getByRole('combobox', { name: 'Group by' }))).toBe(Math.round(filterField!.height))
  expect(await heightOf(sheet.getByRole('combobox', { name: 'Then by' }))).toBe(Math.round(filterField!.height))
  // A switch's row is what a tap lands on
  for (const name of ['Show bank logos', 'Keep groups expanded']) {
    const row = sheet.locator('label').filter({ hasText: name })
    expect(await heightOf(row), name).toBeGreaterThanOrEqual(44)
  }
})

test('on a phone, a bank’s full name keeps its line, and a long account name wraps beside its balance', async ({
  page,
  request,
}) => {
  const user = await signUpUser(request)
  // Short enough for the phone's full width, too long to share it with the bank's total
  const bank = `Northern Savings ${crypto.randomUUID().slice(0, 6)}`
  const institution = await request.post(`${API_BASE_URL}/institutions`, {
    headers: asUser(user),
    data: { name: bank, country_code: 'CA', website: 'https://example.com' },
  })
  expect(institution.status()).toBe(201)
  const { id } = (await institution.json()) as { id: string }
  const taxAdvantagedCategoryId = await createTaxAdvantagedCategory(request, user, 'TFSA')
  await createAccount(request, user, {
    // Too long to share a phone's line with its tag and balance
    name: 'Tax-Free First Home Savings Account',
    accountType: 'savings',
    startingBalance: 2_190_412,
    institutionId: id,
    taxAdvantagedCategoryId,
  })
  await createAccount(request, user, {
    name: 'RRSP Self-directed',
    accountType: 'investment',
    startingBalance: 1_988_043,
    institutionId: id,
  })
  await createAccount(request, user, { name: 'Chequing', startingBalance: 642_600, institutionId: id })
  await logInViaApi(page, user)
  await page.route(/gstatic\.com\/faviconV2/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }),
  )
  // Set once, so the switch to account type below survives its reload
  await page.addInitScript((key) => localStorage.getItem(key) ?? localStorage.setItem(key, 'institution'), GROUPING_KEY)
  await page.setViewportSize({ width: 390, height: 844 })
  await openPage(page, '/accounts')

  // A name set inline has no width of its own, so it's cut when the block holding it overflows
  const isCut = (locator: Locator) =>
    locator.evaluate((element) => {
      const block = getComputedStyle(element).display === 'inline' ? element.parentElement! : element
      return block.scrollWidth > block.clientWidth
    })
  const box = async (locator: Locator) => (await locator.boundingBox())!

  const header = groupHeading(page, bank)
  const title = header.locator('span.font-serif')
  const total = header.getByText('$48,210.55')
  await expect(title).toHaveText(bank)
  await expect(header).toContainText('3 accounts')
  expect(await isCut(title)).toBe(false)
  expect((await box(total)).y).toBeGreaterThanOrEqual((await box(title)).y + (await box(title)).height)

  const row = accountRow(page, /Tax-Free First Home Savings Account/)
  const name = row.getByText('Tax-Free First Home Savings Account', { exact: true })
  const balance = row.getByText('$21,904.12')
  await expect(row.getByText('TFSA', { exact: true })).toBeVisible()
  await expect(row.getByText('Savings', { exact: true })).toBeVisible()
  // The bank's header carries its logo, so its rows leave it out
  await expect(header.getByRole('img', { name: `${bank} logo` })).toBeVisible()
  await expect(row.getByRole('img')).toHaveCount(0)
  expect(await isCut(name)).toBe(false)
  // Too long to share the line with its balance, the name wraps onto a second line, and the balance
  // stays beside its first
  const nameBox = await box(name)
  const lineHeight = await name.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight))
  expect(nameBox.height).toBeGreaterThan(lineHeight * 1.5)
  expect(Math.abs((await box(balance)).y - nameBox.y)).toBeLessThan(lineHeight / 2)
  // The plan tag follows the name's last word, on its last line
  const tagBox = await box(row.getByText('TFSA', { exact: true }))
  expect(tagBox.y).toBeGreaterThan(nameBox.y + nameBox.height - lineHeight - 2)
  // The bank's total ends where its accounts' balances do
  const totalBox = await box(total)
  const balanceBox = await box(balance)
  expect(Math.abs(totalBox.x + totalBox.width - (balanceBox.x + balanceBox.width))).toBeLessThan(2)

  // A guide line runs from under the bank's logo, centred on it, down past its last account
  const section = page.locator('section').filter({ has: header }).first()
  const guides = section.locator('[data-group-guide]')
  await expect(guides).toHaveCount(2)
  const logoBox = await box(header.getByRole('img', { name: `${bank} logo` }))
  const [upper, lower] = [await box(guides.first()), await box(guides.last())]
  const logoMiddle = logoBox.x + logoBox.width / 2
  expect(Math.abs(upper.y - (logoBox.y + logoBox.height))).toBeLessThan(2)
  expect(Math.abs(upper.x + upper.width / 2 - logoMiddle)).toBeLessThan(1)
  expect(Math.abs(lower.x + lower.width / 2 - logoMiddle)).toBeLessThan(1)
  expect(Math.abs(lower.y - (upper.y + upper.height))).toBeLessThan(1)
  const lastRowBox = await box(section.locator(ACCOUNT_ROW).last())
  expect(lower.y + lower.height).toBeGreaterThanOrEqual(lastRowBox.y + lastRowBox.height)
  // On a phone the space between accounts separates them, with no line, and the header shows no dots
  const dividers = await section
    .locator(ACCOUNT_ROW)
    .evaluateAll((rows) => rows.map((row) => getComputedStyle(row.parentElement!).borderTopWidth))
  expect(dividers).toEqual(['0px', '0px', '0px'])
  await expect(header.locator('[data-account-dots]')).toBeHidden()
  // A folded group draws no line
  await header.getByRole('button').click()
  await expect(guides).toHaveCount(0)
  await header.getByRole('button').click()
  await expect(row).toBeVisible()

  // A shorter phone keeps the same width, and so the same full names
  await page.setViewportSize({ width: 390, height: 667 })
  expect(await isCut(title)).toBe(false)
  expect(await isCut(name)).toBe(false)

  // Grouped by account type, no header names the bank, so the row keeps its logo
  await page.evaluate((key) => localStorage.setItem(key, 'type'), GROUPING_KEY)
  await page.reload()
  const typeRow = accountRow(page, /Tax-Free First Home Savings Account/)
  const typeLogo = typeRow.getByRole('img', { name: `${bank} logo` })
  await expect(typeLogo).toBeVisible()
  const typeName = typeRow.getByText('Tax-Free First Home Savings Account', { exact: true })
  expect(await isCut(typeName)).toBe(false)
  // Every line of the wrapped name starts right of the logo, none running back under it
  const typeNameBox = await box(typeName)
  const typeLogoBox = await box(typeLogo)
  expect(typeNameBox.height).toBeGreaterThan(lineHeight * 1.5)
  expect(typeNameBox.x).toBeGreaterThanOrEqual(typeLogoBox.x + typeLogoBox.width)
  // The bank's name on the second line has the width the balance above it leaves
  expect(await isCut(typeRow.getByText(bank, { exact: true }))).toBe(false)
})

test('on a phone, a credit card’s available amount follows its type, shortening and then leaving as the line narrows', async ({
  page,
  request,
}) => {
  const { user } = await seedAccounts(page, request)
  // A balance wider than its available line, so the wide check can't pass on the line's own width
  await createAccount(request, user, {
    name: 'Travel card',
    accountType: 'credit_card',
    accountKind: 'revolving',
    startingBalance: -2_000_000,
    creditLimit: 2_782_966,
  })
  // A card in another currency, whose converted amount shares the second line with its available amount
  await createAccount(request, user, {
    name: 'Abroad card',
    accountType: 'credit_card',
    accountKind: 'revolving',
    currency: 'USD',
    startingBalance: -217_034,
    creditLimit: 2_999_999,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await openPage(page, '/accounts')

  // The store card owes $300.00 of its $1,000.00 limit, and its amount available follows its type
  const row = accountRow(page, /Store card/)
  const balance = row.getByText('($300.00)', { exact: true })
  const box = async (locator: Locator) => (await locator.boundingBox())!
  const metaLine = row.locator('p.text-sm')
  await expect(metaLine).toHaveText(/ · \$700\.00 avail\.$/)
  const lineHeight = await metaLine.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight))

  // As the row narrows, the travel card's amount takes the longest form that keeps its line whole,
  // and the converted amount on the right never wraps
  const travel = accountRow(page, /Travel card/)
  const travelLine = travel.locator('p.text-sm')
  const forms = ['$7,829.66 avail.', '$7,829 avail.', '$7.8K avail.', '$7K avail.']
  const seen = new Set<string>()
  const converted = accountRow(page, /Abroad card/).getByText(/^(≈|FX unavailable)/)
  await expect(converted).toBeVisible()
  const convertedLineHeight = await converted.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight))
  for (const width of [600, 390, 360, 340, 330, 320, 300, 280]) {
    await page.setViewportSize({ width, height: 844 })
    // The fitting runs after the resize lays the row out
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect((await box(converted)).height).toBeLessThan(convertedLineHeight * 1.5)
    const shown = travelLine.locator('[data-credit-available]')
    if (await shown.isVisible()) {
      const text = (await shown.textContent())!.trim()
      expect(forms).toContain(text)
      // A shown amount never pushes its line onto a second
      expect((await box(travelLine)).height).toBeLessThan(lineHeight * 1.5)
      seen.add(text)
    } else seen.add('none')
  }
  expect([...seen]).toContain(forms[0])
  expect(seen.size).toBeGreaterThan(2)

  // Wider screens keep it under the balance, ending where the balance does
  await page.setViewportSize({ width: 1280, height: 800 })
  const available = row.getByText('$700.00 avail.', { exact: true }).filter({ visible: true })
  const wideAvailable = await box(available)
  const wideBalance = await box(balance)
  expect(Math.abs(wideAvailable.x + wideAvailable.width - (wideBalance.x + wideBalance.width))).toBeLessThan(1)
  expect(wideAvailable.y).toBeGreaterThan(wideBalance.y)
  const travelAvailable = await box(travel.getByText('$7,829.66 avail.', { exact: true }).filter({ visible: true }))
  const travelBalance = await box(travel.getByText('($20,000.00)', { exact: true }))
  expect(Math.abs(travelAvailable.x + travelAvailable.width - (travelBalance.x + travelBalance.width))).toBeLessThan(1)
})

test('an open top-level group’s header sticks under the toolbar while its rows scroll past, and closing it from there keeps it in view', async ({
  page,
  request,
}) => {
  const { user } = await seedAccounts(page, request)
  // Enough savings accounts that their group runs well past one screen of a short phone
  for (let index = 1; index <= 8; index += 1) {
    await createAccount(request, user, { name: `Savings ${index}`, accountType: 'savings', startingBalance: 10_000 * index })
  }
  await page.setViewportSize({ width: 390, height: 600 })
  await openPage(page, '/accounts')

  const header = groupButton(page, 'Savings')
  const firstRow = accountRow(page, /Savings 8/)
  await expect(firstRow).toBeVisible()
  const box = async (locator: Locator) => (await locator.boundingBox())!
  // The toolbar is the sticky row holding the search field, with the phone's buttons under it
  const toolbarBottom = () =>
    page
      .getByPlaceholder('Search accounts...')
      .filter({ visible: true })
      .evaluate((element) => {
        let node: Element | null = element
        while (node && getComputedStyle(node).position !== 'sticky') node = node.parentElement
        return node!.getBoundingClientRect().bottom
      })

  // Scrolled so the group's first rows have gone under the toolbar
  const headerStart = await header.evaluate((element) => element.getBoundingClientRect().top + window.scrollY)
  await page.evaluate((top) => window.scrollTo(0, top), headerStart + 250)
  await expect
    .poll(async () => (await box(header)).y - (await toolbarBottom()))
    .toBeGreaterThanOrEqual(0)
  const stuck = await box(header)
  expect(stuck.y - (await toolbarBottom())).toBeLessThan(24)
  // The rows scroll on under it while it stays put
  expect((await box(firstRow)).y).toBeLessThan(stuck.y)

  // Closing it from there brings the page back to the group, so its header stays on screen
  await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(async () => (await box(header)).y).toBeGreaterThanOrEqual(stuck.y - 1)
  await expect(header).toBeInViewport()
})

test('on a desktop, an open group draws a guide line from its logo to its last row, and a line between rows', async ({
  page,
  request,
}) => {
  await seedAccounts(page, request)
  await page.setViewportSize({ width: 1280, height: 800 })
  await openPage(page, '/accounts')
  await chooseFirstLevel(page, 'Institution')
  await closePanel(page)

  // The group with no bank holds the cash and the store card
  const section = groupHeading(page, 'No institution').locator('xpath=ancestor::section[1]')
  const rows = section.locator(ACCOUNT_ROW)
  await expect(rows).toHaveCount(2)
  const dividers = await rows.evaluateAll((items) => items.map((item) => getComputedStyle(item.parentElement!).borderTopWidth))
  expect(dividers).toEqual(['0px', '1px'])

  // The guide runs from under the mark down the body, ending with the last row, once the regroup's glide settles
  const measureGuide = () => section.evaluate((element) => {
    const [header, body] = [...element.querySelectorAll('[data-group-guide]')].map((line) => line.getBoundingClientRect())
    const mark = element.querySelector('h3 button')!.firstElementChild!.getBoundingClientRect()
    const rowBoxes = element.querySelectorAll('[data-testid^="account-row-"]')
    const lastRow = rowBoxes[rowBoxes.length - 1].getBoundingClientRect()
    return { start: header.top - mark.bottom, joined: body.top - header.bottom, end: body.bottom - lastRow.bottom }
  })
  // Settled once two readings 400ms apart agree, since a reading mid-glide can pass on its way through
  let guide = await measureGuide()
  await expect
    .poll(async () => {
      const earlier = guide
      await page.waitForTimeout(400)
      guide = await measureGuide()
      return Math.abs(guide.end - earlier.end)
    })
    .toBeLessThan(0.5)
  // Within the subpixel rounding of the rows, where the body's padding would leave 12px
  expect(Math.abs(guide.start)).toBeLessThan(2)
  expect(Math.abs(guide.joined)).toBeLessThan(2)
  expect(Math.abs(guide.end)).toBeLessThan(2)
})

test('rows under a sub-group start where the sub-group’s title does', async ({ page, request }) => {
  await seedAccounts(page, request)
  await openPage(page, '/accounts')
  await chooseFirstLevel(page, 'Institution')
  await expect(page.getByRole('option')).toHaveCount(0)
  await chooseLevel(page, 'Then by', 'Account type')
  await expect(page.getByRole('option')).toHaveCount(0)
  await closePanel(page)

  await groupHeading(page, 'Savings').getByRole('button').click()
  const section = page.locator('section').filter({ has: groupHeading(page, 'Savings') }).last()
  const title = section.getByRole('heading').locator('span.font-serif')
  const row = section.locator(ACCOUNT_ROW)
  await expect(row).toBeVisible()
  // Both are read once the body has finished opening. The row's first mark or text is its leftmost drawn part
  await expect
    .poll(async () => {
      const titleBox = await title.boundingBox()
      const rowLeft = await row.evaluate((item) =>
        Math.min(
          ...[...item.querySelectorAll('*')]
            .filter((element) => element.children.length === 0 && element.getBoundingClientRect().width > 0)
            .map((element) => element.getBoundingClientRect().x),
        ),
      )
      return Math.abs(rowLeft - titleBox!.x)
    })
    .toBeLessThan(2)
})
