/**
 * Guards the Import rules section of Settings: creating and editing a rule in its editor, and ordering the
 * rules by menu, keyboard and mouse so the order survives a reload
 */
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createCategory, signUpUser, type TestUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'
import { API_BASE_URL } from '../support/target'

// Runs at every size for the tests that create a rule, order the rules and hold the buttons off at the budget of
// conditions, since the row, its menu, the grips and the reasons lay out and take touch differently there. The
// editor's validation, its edit and Cancel, the delete and the merchant delete a rule blocks run on desktop only:
// they give the same result at every size

async function createMerchant(request: APIRequestContext, user: TestUser, name: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/merchants`, { headers: asUser(user), data: { name } })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { id: string }).id
}

async function createRule(request: APIRequestContext, user: TestUser, name: string, merchantId: string): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/import-rules`, {
    headers: asUser(user),
    data: {
      name,
      match: 'all',
      conditions: [{ kind: 'condition', attribute: 'description', operator: 'contains', value: name }],
      merchant_id: merchantId,
      tag_ids: [],
    },
  })
  expect(response.status()).toBe(201)
}

/**
 * Makes `count` rules named "Rule 01", "Rule 02" and so on, every third one with tags. The chips wrap at phone width
 * and make that row taller than the rest
 */
async function createRulesOfUnequalHeight(request: APIRequestContext, user: TestUser, count: number): Promise<string[]> {
  const merchantId = await createMerchant(request, user, 'Market')
  const tagIds: string[] = []
  for (const name of ['Reimbursable expenses', 'Subscriptions and dues', 'Holiday travel costs', 'Shared household costs']) {
    const response = await request.post(`${API_BASE_URL}/tags`, { headers: asUser(user), data: { name } })
    expect(response.status()).toBe(201)
    tagIds.push(((await response.json()) as { id: string }).id)
  }
  const names: string[] = []
  for (let index = 1; index <= count; index += 1) {
    const name = `Rule ${String(index).padStart(2, '0')}`
    names.push(name)
    const response = await request.post(`${API_BASE_URL}/import-rules`, {
      headers: asUser(user),
      data: {
        name,
        match: 'all',
        conditions: [{ kind: 'condition', attribute: 'description', operator: 'contains', value: name }],
        merchant_id: merchantId,
        tag_ids: index % 3 === 2 ? tagIds : [],
      },
    })
    expect(response.status()).toBe(201)
  }
  return names
}

/** The rules as the server holds them, in the order they are checked */
async function readRules(request: APIRequestContext, user: TestUser) {
  const response = await request.get(`${API_BASE_URL}/import-rules?limit=50&offset=0`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  return (await response.json()) as Array<{ id: string; name: string; position: number; merchant: { id: string } | null }>
}

async function readOrder(request: APIRequestContext, user: TestUser): Promise<string[]> {
  return (await readRules(request, user)).map((rule) => rule.name)
}

/** Signs a user in with a merchant and three rules, Alpha then Beta then Gamma, and opens the section */
async function openThreeRules(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request)
  const suffix = crypto.randomUUID().slice(0, 8)
  const names = [`Alpha ${suffix}`, `Beta ${suffix}`, `Gamma ${suffix}`]
  const merchantId = await createMerchant(request, user, `Merchant ${suffix}`)
  for (const name of names) await createRule(request, user, name, merchantId)

  await logInViaApi(page, user)
  await openPage(page, '/settings#import-rules')
  const section = page.locator('#import-rules')
  await expect(section.getByRole('status', { name: 'Loading import rules' })).toHaveCount(0)
  await expect(section.getByRole('listitem')).toHaveCount(3)
  await bringToRest(page, section)
  return { user, names, section }
}

/**
 * Waits until the page has stopped scrolling to the section the link names
 *
 * The page grows as each section loads, and the smooth scroll to the link's section aims at where its heading
 * was, so it can run after the rows show. A mouse press aimed at a row, or a menu that closes when the page
 * scrolls, would miss while it is still under way. The section is read as still once its heading sits at the
 * same place on enough reads in a row
 */
async function bringToRest(page: Page, section: Locator) {
  await expect(page.getByRole('status', { name: /^Loading / })).toHaveCount(0)
  const heading = section.getByRole('heading', { level: 2, name: 'Import rules', exact: true })
  const firstRow = section.getByRole('listitem').first()
  const untilStill = async () => {
    let last: number | undefined
    let reads = 0
    await expect
      .poll(
        async () => {
          const top = (await heading.boundingBox())?.y
          reads = top === last ? reads + 1 : 0
          last = top
          return reads
        },
        { intervals: [100] },
      )
      .toBeGreaterThanOrEqual(8)
  }
  await heading.scrollIntoViewIfNeeded()
  await untilStill()
  // The scroll to the link can end with the heading at the foot of the window and the rows below it,
  // when the sections above grew after the scroll took its aim. The rows are what the tests press
  await firstRow.scrollIntoViewIfNeeded()
  await untilStill()
  await expect(firstRow).toBeInViewport()
}

/** Waits until an element has stayed at the same height on enough reads in a row, so nothing is still moving it */
async function holdStill(target: Locator) {
  let last: number | undefined
  let reads = 0
  await expect
    .poll(
      async () => {
        const top = (await target.boundingBox())?.y
        reads = top === last ? reads + 1 : 0
        last = top
        return reads
      },
      { intervals: [100] },
    )
    .toBeGreaterThanOrEqual(8)
}

/**
 * Puts a row in the middle of the window and waits until it has stopped moving
 *
 * A menu closes on any scroll. A press by the test runner on a row that sits under the fixed header or at the
 * window's edge first scrolls the page to reveal it, and that scroll's event arrives after the press has opened the
 * menu and closes it. Nothing in the app scrolls then. A row already in the clear is pressed where it stands, as a
 * person presses it
 */
async function settleRow(row: Locator) {
  await row.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await holdStill(row)
}

/**
 * Waits until a row is announced as picked up, and then for the browser to run what the pick-up queued
 *
 * The drag library starts listening for the arrow keys in a timer it sets as it picks the row up, a moment after the
 * announcement is drawn. A key pressed in between is lost. A person's key press comes far later and never meets this.
 * A timer set after the announcement runs after the library's, so awaiting one is the first moment a key lands
 */
async function expectPickedUp(page: Page, name: string) {
  await expect(page.getByText(`Picked up ${name}`)).toBeAttached()
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
}

/** The titles of the rows on screen, top to bottom */
async function readShownOrder(section: Locator, names: string[]): Promise<string[]> {
  const rows = await section.getByRole('listitem').allInnerTexts()
  return rows.map((text) => names.find((name) => text.includes(name)) ?? text)
}

/** Presses the row's name and sentence, the one button that opens the editor, whose name starts with the rule's */
async function openRuleEditor(section: Locator, name: string) {
  await section.getByRole('button', { name: new RegExp(`^${name}\\s`) }).click()
}

async function openRowMenu(page: Page, section: Locator, name: string) {
  const trigger = section.getByRole('button', { name: `Actions for ${name}`, exact: true })
  // A menu closes on any scroll. A click that has to scroll its button into view first opens the menu in the
  // same frame. The browser delivers the scroll event with the next frame, and it then closes the menu. A person
  // scrolls first and presses after, so the scroll is made and shown before the press
  await trigger.scrollIntoViewIfNeeded()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await trigger.click()
  return page.getByRole('menu', { name: `Actions for ${name}` })
}

test('creates a rule in the editor and shows it with its sentence and what it sets', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const suffix = crypto.randomUUID().slice(0, 8)
  const merchantName = `Corner Market ${suffix}`
  const merchantId = await createMerchant(request, user, merchantName)

  await logInViaApi(page, user)
  await openPage(page, '/settings#import-rules')
  const section = page.locator('#import-rules')
  await expect(section.getByRole('status', { name: 'Loading import rules' })).toHaveCount(0)
  await expect(section.getByText('No import rules yet.')).toBeVisible()

  await section.getByRole('button', { name: 'Create rule', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create rule' })
  await dialog.getByRole('textbox', { name: 'Rule name', exact: true }).fill(`Groceries ${suffix}`)
  await dialog.getByRole('textbox', { name: 'Condition 1 value', exact: true }).fill('GROCER')
  await chooseFromDropdown(dialog, 'Set merchant', merchantName)
  await dialog.getByRole('button', { name: 'Create rule', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  const row = section.getByRole('listitem').filter({ hasText: `Groceries ${suffix}` })
  await expect(row).toContainText('Description contains "GROCER"')
  await expect(row).toContainText(merchantName)
  const [rule, ...others] = await readRules(request, user)
  expect(others).toEqual([])
  expect(rule).toMatchObject({ name: `Groceries ${suffix}`, position: 0, merchant: { id: merchantId } })
})

test('fills in a picked merchant\'s default category over a chosen one, and a merchant without one leaves the category', async ({ page, request }) => {
  const user = await signUpUser(request)
  const suffix = crypto.randomUUID().slice(0, 8)
  const categoryName = `Groceries ${suffix}`
  const categoryId = await createCategory(request, user, { name: categoryName })
  const chosenName = `Household ${suffix}`
  await createCategory(request, user, { name: chosenName })
  const withDefault = `Corner Market ${suffix}`
  const response = await request.post(`${API_BASE_URL}/merchants`, {
    headers: asUser(user),
    data: { name: withDefault, default_category_id: categoryId },
  })
  expect(response.status()).toBe(201)
  const withoutDefault = `Bakery ${suffix}`
  await createMerchant(request, user, withoutDefault)

  await logInViaApi(page, user)
  await openPage(page, '/settings#import-rules')
  const section = page.locator('#import-rules')
  await section.getByRole('button', { name: 'Create rule', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create rule' })
  const category = dialog.getByRole('combobox', { name: 'Set category' })
  await chooseFromDropdown(dialog, 'Set category', chosenName)
  await expect(category).toContainText(chosenName)

  // The field shows the category's icon before its name
  await chooseFromDropdown(dialog, 'Set merchant', withDefault)
  await expect(category).toContainText(categoryName)

  await chooseFromDropdown(dialog, 'Set merchant', withoutDefault)
  await expect(category).toContainText(categoryName)
  await chooseFromDropdown(dialog, 'Set merchant', 'No merchant')
  await expect(category).toContainText(categoryName)
})

test('refuses an empty text value in the editor and saves nothing', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#import-rules')
  const section = page.locator('#import-rules')

  await section.getByRole('button', { name: 'Create rule', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create rule' })
  const value = dialog.getByRole('textbox', { name: 'Condition 1 value', exact: true })
  await dialog.getByRole('textbox', { name: 'Rule name', exact: true }).fill('Empty text')
  await dialog.getByRole('button', { name: 'Create rule', exact: true }).click()

  // The rule sets nothing either, so the actions also show an error of their own
  await expect(dialog.getByRole('alert').filter({ hasText: 'Enter the text to match' })).toBeVisible()
  await expect(dialog.getByRole('alert').filter({ hasText: 'Please choose a merchant, a category or at least one tag' })).toBeVisible()
  await expect(value).toHaveAttribute('aria-invalid', 'true')
  await expect(value).toBeFocused()
  expect(await readRules(request, user)).toEqual([])
})

/** Whether text in the control or anything inside it is wider than the room it is drawn in, so cut or spilling out */
async function hasCutText(control: Locator): Promise<boolean> {
  return control.evaluate((node) =>
    // Screen-reader-only text is a one pixel box holding a longer line, so it is left out
    [node, ...Array.from(node.querySelectorAll('*'))].some(
      (element) => element.clientWidth > 1 && element.scrollWidth > element.clientWidth + 1,
    ),
  )
}

/** Opens a dropdown and waits until its box has settled, then reads the box and the field it grew from */
async function openedBoxAndSlot(control: Locator) {
  await control.click()
  const slot = control.locator('xpath=ancestor::*[@data-testid="dropdown-slot"]')
  const box = slot.getByTestId('dropdown-box')
  await expect(control).toHaveAttribute('aria-expanded', 'true')
  const slotWidth = (await slot.boundingBox())!.width
  await expect.poll(async () => Math.abs((await box.boundingBox())!.width - slotWidth), { timeout: 5_000 }).toBeLessThan(1.5)
  return { slot: (await slot.boundingBox())!, box: (await box.boundingBox())! }
}

test('gives a condition value room to read in full, at every size and inside a group', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, '/settings#import-rules')
  await page.locator('#import-rules').getByRole('button', { name: 'Create rule', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create rule' })
  const addCondition = dialog.getByRole('button', { name: 'Add condition', exact: true })

  await dialog.getByRole('textbox', { name: 'Condition 1 value', exact: true }).fill('GROCERIESXYZ')
  await addCondition.first().click()
  // A field's name is matched from its start, since "Condition 1 attribute" is also part of "Group 1 condition 1
  // attribute" and the name ends with the chosen value
  const choose = async (field: string, option: string) => {
    await dialog.getByRole('combobox', { name: new RegExp(`^${field}\\b`) }).click()
    const optionName = new RegExp(`^${option}\\b`)
    await dialog.getByRole('option', { name: optionName }).click()
    // The list that was open finishes closing before the next one opens, so two never answer to one name
    await expect(dialog.getByRole('option', { name: optionName })).toHaveCount(0)
  }
  await choose('Condition 2 attribute', 'Amount')
  await dialog.getByRole('textbox', { name: 'Condition 2 amount', exact: true }).fill('1250')
  await addCondition.first().click()
  await choose('Condition 3 attribute', 'Direction')
  await choose('Condition 3 value', 'Money out')
  await addCondition.first().click()
  await choose('Condition 4 attribute', 'Account')
  await choose('Condition 4 value', 'Everyday chequing')
  await dialog.getByRole('button', { name: 'Add group', exact: true }).click()
  await choose('Group 1 condition 1 attribute', 'Amount')
  await dialog.getByRole('textbox', { name: 'Group 1 condition 1 amount', exact: true }).fill('1250')

  const dialogBox = (await dialog.boundingBox())!
  const controls: Array<[string, Locator]> = [
    ['Condition 1 value', dialog.getByRole('textbox', { name: 'Condition 1 value', exact: true })],
    ['Condition 2 amount', dialog.getByRole('textbox', { name: 'Condition 2 amount', exact: true })],
    ['Condition 2 currency', dialog.getByRole('combobox', { name: 'Condition 2 currency' })],
    ['Condition 3 value', dialog.getByRole('combobox', { name: 'Condition 3 value' })],
    ['Condition 4 value', dialog.getByRole('combobox', { name: 'Condition 4 value' })],
    ['Group 1 condition 1 amount', dialog.getByRole('textbox', { name: 'Group 1 condition 1 amount', exact: true })],
    ['Group 1 condition 1 currency', dialog.getByRole('combobox', { name: 'Group 1 condition 1 currency' })],
  ]
  for (const [name, control] of controls) {
    expect(await hasCutText(control), `${name} shows its text in full`).toBe(false)
    const box = (await control.boundingBox())!
    expect(box.x + box.width, `${name} stays inside the dialogue`).toBeLessThanOrEqual(dialogBox.x + dialogBox.width)
  }
  await expect(controls[2][1]).toContainText('CAD')
  await expect(controls[2][1]).not.toContainText('…')
  await expect(controls[4][1]).toContainText('Everyday chequing')

  // Each remove button is clear of the field before it and can be pressed. A trial click fails if something covers it
  for (const [removeName, controlIndex] of [
    ['Remove condition 1', 0],
    ['Remove condition 2', 2],
    ['Remove condition 4', 4],
    ['Remove group 1 condition 1', 6],
  ] as const) {
    const remove = dialog.getByRole('button', { name: removeName, exact: true })
    await remove.click({ trial: true })
    const value = (await controls[controlIndex][1].boundingBox())!
    expect(value.x + value.width, `${controls[controlIndex][0]} ends before ${removeName}`).toBeLessThanOrEqual((await remove.boundingBox())!.x)
  }

  // A small dropdown opens as wide as itself, and a list opens under its own field and inside the dialogue
  const matchField = dialog.getByRole('combobox', { name: /^The rule matches/ })
  const match = await openedBoxAndSlot(matchField)
  expect(match.box.width).toBeLessThan(160)
  await page.keyboard.press('Escape')
  const attribute = await openedBoxAndSlot(dialog.getByRole('combobox', { name: /^Condition 1 attribute\b/ }))
  expect(Math.abs(attribute.box.x - attribute.slot.x)).toBeLessThan(1.5)
  await page.keyboard.press('Escape')
  const tags = await openedBoxAndSlot(dialog.getByRole('combobox', { name: 'Add tags' }))
  expect(tags.box.x + tags.box.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width)
})

test('keeps every rule to one line of summary from 750px and to two below, at every size', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const merchantId = await createMerchant(request, user, 'Corner Market')
  const long = `LONG ${'X'.repeat(80)}`
  for (const name of ['Short one', long, 'Short two']) await createRule(request, user, name, merchantId)
  await logInViaApi(page, user)
  await openPage(page, '/settings#import-rules')
  const section = page.locator('#import-rules')
  await expect(section.getByRole('listitem')).toHaveCount(3)
  await page.waitForLoadState('networkidle')

  const measures = await section.getByRole('listitem').evaluateAll((rows) =>
    rows.map((row) => {
      const summary = Array.from(row.querySelectorAll('span')).find(
        (span) => span.textContent?.startsWith('Description contains') && getComputedStyle(span).display !== 'none',
      )!
      return { row: row.getBoundingClientRect().height, summary: summary.getBoundingClientRect().height, line: parseFloat(getComputedStyle(summary).lineHeight) }
    }),
  )
  // From 750px the sentence is one line, and below that it takes at most two
  const wide = (page.viewportSize()?.width ?? 0) >= 750
  for (const { summary, line } of measures) expect(summary).toBeLessThanOrEqual((wide ? 1 : 2) * line + 1)
  // The first and the last rule have a sentence of one line each, so they are as tall as each other, the last included
  expect(measures[0].row, 'the last row is as tall as the first').toBe(measures[2].row)
  if (wide) expect(new Set(measures.map((measure) => measure.row)).size, 'every row is as tall as the others').toBe(1)
})

test('moves a rule with its menu and with the keyboard, and keeps the order after a reload', AT_EVERY_SIZE, async ({ page, request }) => {
  const { user, names, section } = await openThreeRules(page, request)
  const [alpha, beta, gamma] = names

  // The first rule can't move up and the last can't move down, and each says why. The reason hangs clear of the menu
  const firstMenu = await openRowMenu(page, section, alpha)
  await expect(firstMenu.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(firstMenu.getByRole('menuitem', { name: 'Move up' })).toBeFocused()
  const reason = page.locator('span[aria-hidden="true"]').filter({ hasText: /^This rule is already first$/ })
  await expect(reason).toBeVisible()
  const reasonBox = (await reason.boundingBox())!
  const menuBox = (await firstMenu.boundingBox())!
  const apart =
    reasonBox.x + reasonBox.width <= menuBox.x ||
    reasonBox.x >= menuBox.x + menuBox.width ||
    reasonBox.y + reasonBox.height <= menuBox.y ||
    reasonBox.y >= menuBox.y + menuBox.height
  expect(apart, 'the reason does not cover the menu').toBe(true)
  await firstMenu.getByRole('menuitem', { name: 'Move down' }).click()
  await expect.poll(() => readOrder(request, user)).toEqual([beta, alpha, gamma])
  await expect.poll(() => readShownOrder(section, names)).toEqual([beta, alpha, gamma])

  // The keyboard picks the grip up with Space, moves it with an arrow and drops it with Space
  const grip = section.getByRole('button', { name: `Move ${gamma}`, exact: true })
  await grip.focus()
  await page.keyboard.press('Space')
  await expect(grip).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(`Picked up ${gamma}`)).toBeAttached()
  // The held row is drawn lifted, with a shadow the others lack, once the fade in has run
  const shadowOf = (name: string) =>
    section.getByRole('listitem').filter({ hasText: name }).evaluate((row) => getComputedStyle(row).boxShadow)
  const flat = 'rgba(0, 0, 0, 0) 0px 0px 0px 0px'
  expect(await shadowOf(beta)).toBe(flat)
  await expect.poll(() => shadowOf(gamma)).not.toBe(flat)
  await page.keyboard.press('ArrowUp')
  await expect(page.getByText(`${gamma} is now over number 2 of 3`)).toBeAttached()
  await page.keyboard.press('Space')
  await expect.poll(() => readOrder(request, user)).toEqual([beta, gamma, alpha])
  await expect.poll(() => readShownOrder(section, names)).toEqual([beta, gamma, alpha])

  await page.reload()
  await expect(section.getByRole('status', { name: 'Loading import rules' })).toHaveCount(0)
  await expect.poll(() => readShownOrder(section, names)).toEqual([beta, gamma, alpha])
})

// Desktop only: a touch screen has no hover to fill an item with
test('gives a menu item that can be chosen the hover fill, and one that can not none', async ({ page, request }) => {
  const { names, section } = await openThreeRules(page, request)
  const menu = await openRowMenu(page, section, names[0])
  const fillOf = (item: Locator) => item.evaluate((element) => getComputedStyle(element).backgroundColor)
  const clear = 'rgba(0, 0, 0, 0)'
  const moveDown = menu.getByRole('menuitem', { name: 'Move down' })
  const moveUp = menu.getByRole('menuitem', { name: 'Move up' })

  await moveDown.hover()
  await expect.poll(() => fillOf(moveDown)).not.toBe(clear)

  await moveUp.hover()
  await expect(moveUp).toHaveAttribute('aria-disabled', 'true')
  await expect.poll(() => fillOf(moveDown)).toBe(clear)
  expect(await fillOf(moveUp)).toBe(clear)
})

test('drags a rule by its grip with the mouse, and Escape puts a held rule back', AT_EVERY_SIZE, async ({ page, request }) => {
  const { user, names, section } = await openThreeRules(page, request)
  const [alpha, beta, gamma] = names

  const grip = section.getByRole('button', { name: `Move ${alpha}`, exact: true })
  const target = section.getByRole('listitem').filter({ hasText: gamma })
  const from = (await grip.boundingBox())!
  const to = (await target.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 12, { steps: 4 })
  await page.mouse.move(from.x + from.width / 2, to.y + to.height / 2 + 8, { steps: 12 })
  await page.mouse.up()

  await expect.poll(() => readOrder(request, user)).toEqual([beta, gamma, alpha])
  await expect.poll(() => readShownOrder(section, names)).toEqual([beta, gamma, alpha])

  // Escape puts a rule picked up by the keyboard back, and sends nothing
  const betaGrip = section.getByRole('button', { name: `Move ${beta}`, exact: true })
  await betaGrip.focus()
  await page.keyboard.press('Space')
  await expectPickedUp(page, beta)
  await page.keyboard.press('ArrowDown')
  await expect(page.getByText(`${beta} is now over number 2 of 3`)).toBeAttached()
  await page.keyboard.press('Escape')
  await expect(page.getByText(`Cancelled. ${beta} stays`)).toBeAttached()
  expect(await readOrder(request, user)).toEqual([beta, gamma, alpha])
})

test('keeps a row where it is when it is dropped with the keyboard, among rows of unequal height', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const names = await createRulesOfUnequalHeight(request, user, 12)
  await logInViaApi(page, user)
  await openPage(page, '/settings#import-rules')
  const section = page.locator('#import-rules')
  await expect(section.getByRole('status', { name: 'Loading import rules' })).toHaveCount(0)
  await bringToRest(page, section)

  // The list scrolls inside its card, and the keyboard scrolls it to follow the held row
  const moved = names[4]
  const row = section.getByRole('listitem').filter({ hasText: moved })
  const grip = section.getByRole('button', { name: `Move ${moved}`, exact: true })
  // The row's place in the list's own content: scrolling the page or the list leaves it alone
  const placeOf = () => row.evaluate((element) => element.getBoundingClientRect().top - element.parentElement!.getBoundingClientRect().top)
  const slotOf = () => row.evaluate((element) => Array.from(element.parentElement!.children).indexOf(element))
  const transformAnimationsOf = () =>
    row.evaluate(
      (element) =>
        element.getAnimations().filter((animation) =>
          animation instanceof CSSTransition
            ? animation.transitionProperty === 'transform'
            : ((animation.effect as KeyframeEffect | null)?.getKeyframes() ?? []).some((frame) => 'transform' in frame),
        ).length,
    )
  await settleRow(row)
  const restPlace = await placeOf()
  const rowHeights = await section.getByRole('listitem').evaluateAll((rows) => rows.map((item) => item.getBoundingClientRect().height))

  await grip.focus()
  await page.keyboard.press('Space')
  await expect(grip).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(`Picked up ${moved}`)).toBeAttached()
  await expect(section.locator('li[data-lifted]')).toHaveCount(1)
  await page.keyboard.press('ArrowDown')
  await expect(page.getByText(new RegExp(`${moved} is now over number 6 of`))).toBeAttached()
  // The row travels while it is held: it is a row further down once its own move has ended
  await expect.poll(transformAnimationsOf).toBe(0)
  const heldPlace = await placeOf()
  expect(heldPlace - restPlace, 'the held row moved down by the height of the row it passed').toBeCloseTo(rowHeights[5], 0)
  expect(await slotOf()).toBe(4)

  // Every frame from just before the drop on
  await row.evaluate((element) => {
    const list = element.parentElement!
    const frames: Array<{ place: number; transforms: number; ring: number }> = []
    const watched = window as unknown as { __dropFrames: typeof frames; __dropWatching: boolean }
    watched.__dropFrames = frames
    watched.__dropWatching = true
    const grip = element.querySelector('button')!
    // How strongly the grip's outline is drawn: its colour's alpha, or nothing when it has no outline
    const ringStrength = () => {
      const style = getComputedStyle(grip)
      if (style.outlineStyle === 'none' || parseFloat(style.outlineWidth) === 0) return 0
      const alpha = /^rgba\(.*,\s*([\d.]+)\)$/.exec(style.outlineColor) ?? /\/\s*([\d.]+)\)$/.exec(style.outlineColor)
      return alpha ? Number(alpha[1]) : 1
    }
    const loop = () => {
      frames.push({
        ring: ringStrength(),
        place: element.getBoundingClientRect().top - list.getBoundingClientRect().top,
        transforms: element
          .getAnimations()
          .filter((animation) =>
            animation instanceof CSSTransition
              ? animation.transitionProperty === 'transform'
              : ((animation.effect as KeyframeEffect | null)?.getKeyframes() ?? []).some((frame) => 'transform' in frame),
          ).length,
      })
      if (watched.__dropWatching) requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
  await page.keyboard.press('Space')
  await expect(section.locator('li[data-lifted]')).toHaveCount(0)
  await expect.poll(slotOf).toBe(5)
  // The slide a pointer drop starts would run for 300 ms from here, so the watcher draws frames until the slide's
  // time has passed twice over, as a count of frames and not a wait of a set time
  const framesAtDrop = await page.evaluate(() => (window as unknown as { __dropFrames: unknown[] }).__dropFrames.length)
  await page.waitForFunction(
    (atDrop) => (window as unknown as { __dropFrames: unknown[] }).__dropFrames.length >= atDrop + 36,
    framesAtDrop,
  )
  const frames = await page.evaluate(() => {
    const watched = window as unknown as { __dropFrames: Array<{ place: number; transforms: number; ring: number }>; __dropWatching: boolean }
    watched.__dropWatching = false
    return watched.__dropFrames
  })

  expect(frames.length).toBeGreaterThan(20)
  const moves = frames.filter((frame) => Math.abs(frame.place - heldPlace) > 1)
  expect(moves, `places that left ${heldPlace.toFixed(1)}: ${moves.slice(0, 8).map((frame) => frame.place.toFixed(1)).join(', ')}`).toHaveLength(0)
  expect(frames.filter((frame) => frame.transforms > 0), 'frames with a transform animation on the row').toHaveLength(0)
  // The grip's ring is drawn at full strength in every frame: it does not blink out and fade back in as the row moves
  const dimmed = frames.filter((frame) => frame.ring < 1)
  expect(dimmed, `ring strengths below full: ${dimmed.slice(0, 8).map((frame) => frame.ring.toFixed(2)).join(', ')}`).toHaveLength(0)
  await expect(grip).toBeFocused()
  // Nothing of the held-off fade stays on the grip, so a ring a later Tab brings fades in as every other does
  expect(await grip.evaluate((element) => (element as HTMLElement).style.transition)).toBe('')
  await expect.poll(() => readOrder(request, user)).toEqual([...names.slice(0, 4), names[5], names[4], ...names.slice(6)])
})

test('eases a dropped row into its slot instead of jumping, with the mouse', async ({ page, request }) => {
  const { names, section } = await openThreeRules(page, request)
  const alpha = names[0]
  const row = section.getByRole('listitem').filter({ hasText: alpha })
  await settleRow(row)

  const grip = section.getByRole('button', { name: `Move ${alpha}`, exact: true })
  const from = (await grip.boundingBox())!
  const rowHeight = (await row.boundingBox())!.height
  const x = from.x + from.width / 2
  const y = from.y + from.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 10, { steps: 4 })
  // Held a little past the slot it will take, so the drop has some way to go
  await page.mouse.move(x, y + rowHeight * 0.6, { steps: 10 })
  await expect(section.locator('li[data-lifted]')).toHaveCount(1)
  // The row has stopped following the pointer once nothing of it is still animating
  await expect.poll(() => row.evaluate((element) => element.getAnimations().length)).toBe(0)

  // The top of the row on every frame from the release
  await page.evaluate(() => {
    const held = document.querySelector('ul[aria-label="Import rules"] > li[data-lifted]')!
    const tops: number[] = []
    const watched = window as unknown as { __tops: number[]; __topsDone: boolean }
    watched.__tops = tops
    watched.__topsDone = false
    const started = performance.now()
    const loop = () => {
      tops.push(held.getBoundingClientRect().top)
      if (performance.now() - started < 900) requestAnimationFrame(loop)
      else watched.__topsDone = true
    }
    requestAnimationFrame(loop)
  })
  const heldTop = await row.evaluate((element) => element.getBoundingClientRect().top)
  await page.mouse.up()
  await page.waitForFunction(() => (window as unknown as { __topsDone: boolean }).__topsDone)
  const tops = await page.evaluate(() => (window as unknown as { __tops: number[] }).__tops)

  const slotTop = tops[tops.length - 1]
  expect(Math.abs(slotTop - heldTop)).toBeGreaterThan(20)
  const between = tops.filter((top) => (top - slotTop) * (top - heldTop) < 0 && Math.abs(top - slotTop) > 2 && Math.abs(top - heldTop) > 2)
  expect(between.length, `tops from the release: ${tops.slice(0, 16).map(Math.round).join(', ')}`).toBeGreaterThanOrEqual(2)
  // The row only ever goes from where it was let go to its slot: it never falls back toward the slot it left
  const strayed = tops.filter((top) => top < Math.min(heldTop, slotTop) - 1 || top > Math.max(heldTop, slotTop) + 1)
  expect(strayed, `tops outside ${heldTop.toFixed(1)} to ${slotTop.toFixed(1)}: ${strayed.slice(0, 8).map((top) => top.toFixed(1)).join(', ')}`).toHaveLength(0)
})

test('renames a rule in the editor, and Cancel drops what was typed', async ({ page, request }) => {
  const { user, names, section } = await openThreeRules(page, request)
  const [alpha] = names
  const renamed = `${alpha} renamed`

  await openRuleEditor(section, alpha)
  let dialog = page.getByRole('dialog', { name: 'Edit rule' })
  await dialog.getByRole('textbox', { name: 'Rule name', exact: true }).fill('Typed and dropped')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await readOrder(request, user)).toEqual(names)

  await openRuleEditor(section, alpha)
  dialog = page.getByRole('dialog', { name: 'Edit rule' })
  await expect(dialog.getByRole('textbox', { name: 'Rule name', exact: true })).toHaveValue(alpha)
  await dialog.getByRole('textbox', { name: 'Rule name', exact: true }).fill(renamed)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  await expect(section.getByRole('listitem').filter({ hasText: renamed })).toBeVisible()
  expect((await readOrder(request, user))[0]).toBe(renamed)
})

test('deletes a rule only after the confirmation', async ({ page, request }) => {
  const { user, names, section } = await openThreeRules(page, request)
  const [alpha, beta, gamma] = names

  const menu = await openRowMenu(page, section, beta)
  await menu.getByRole('menuitem', { name: 'Delete' }).click()
  await section.getByRole('button', { name: `Cancel deleting ${beta}`, exact: true }).click()
  expect(await readOrder(request, user)).toEqual(names)

  await (await openRowMenu(page, section, beta)).getByRole('menuitem', { name: 'Delete' }).click()
  await section.getByRole('button', { name: `Confirm delete ${beta}`, exact: true }).click()
  await expect(section.getByRole('listitem')).toHaveCount(2)
  await expect.poll(() => readOrder(request, user)).toEqual([alpha, gamma])
  expect((await readRules(request, user)).map((rule) => rule.position)).toEqual([0, 1])
})

test('names the rule that blocks deleting a merchant, and a replacement takes the rule over', async ({ page, request }) => {
  const user = await signUpUser(request)
  const suffix = crypto.randomUUID().slice(0, 8)
  const usedName = `Used ${suffix}`
  const replacementName = `Replacement ${suffix}`
  const usedId = await createMerchant(request, user, usedName)
  const replacementId = await createMerchant(request, user, replacementName)
  await createRule(request, user, `Market ${suffix}`, usedId)

  await logInViaApi(page, user)
  await openPage(page, '/settings#merchants')
  const merchants = page.locator('#merchants')
  await expect(merchants.getByRole('status', { name: 'Loading merchants' })).toHaveCount(0)
  await merchants.getByRole('button', { name: `Delete ${usedName}`, exact: true }).click()
  await merchants.getByRole('button', { name: `Confirm delete ${usedName}`, exact: true }).click()

  const dialog = page.getByRole('dialog', { name: 'Choose a replacement first' })
  await expect(dialog).toContainText(
    `Merchant is used by the import rule "Market ${suffix}". Please choose another merchant to take its place, then you can delete it.`,
  )
  await expect(dialog).not.toContainText('for those transactions')
  await chooseFromDropdown(dialog, 'Replacement merchant', replacementName)
  await dialog.getByRole('button', { name: 'Replace & Delete', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  const [rule] = await readRules(request, user)
  expect(rule.merchant).toMatchObject({ id: replacementId, name: replacementName })
})

const PAGED_RULE_COUNT = 14
const RULE_PAGE_SIZE = 10

/** Signs a user in with more rules than one page holds, named R01 to R14 in the order they are checked */
async function openPagedRules(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request)
  const suffix = crypto.randomUUID().slice(0, 8)
  const merchantId = await createMerchant(request, user, `Merchant ${suffix}`)
  const names = Array.from({ length: PAGED_RULE_COUNT }, (_, index) => `R${String(index + 1).padStart(2, '0')} ${suffix}`)
  for (const name of names) await createRule(request, user, name, merchantId)

  await logInViaApi(page, user)
  await openPage(page, '/settings#import-rules')
  const section = page.locator('#import-rules')
  await expect(section.getByRole('status', { name: 'Loading import rules' })).toHaveCount(0)
  await expect(section.getByRole('listitem')).toHaveCount(RULE_PAGE_SIZE)
  await bringToRest(page, section)
  return { user, names, section }
}

/** Presses "Show more" until the list holds the rows given. The first presses scroll the list, the one at its end reads a page */
async function showRules(section: Locator, count: number) {
  const showMore = section.getByRole('button', { name: 'Show more import rules', exact: true })
  await expect
    .poll(
      async () => {
        if ((await section.getByRole('listitem').count()) < count && (await showMore.count()) > 0) {
          await showMore.click({ timeout: 2_000 }).catch(() => undefined)
        }
        return section.getByRole('listitem').count()
      },
      { intervals: [500], timeout: 15_000 },
    )
    .toBe(count)
}

test('pages the rules, and keeps the order through a move past the loaded rows and a delete', AT_EVERY_SIZE, async ({ page, request }) => {
  const { user, names, section } = await openPagedRules(page, request)

  // Nothing around the scrolling list may scroll on its own. The screen-reader text in each row sat below the
  // list's scroll area. That gave the clipping box around the list a scroll a focus could move, and the rows
  // shifted up under a blank band
  const scrollableAround = await section.getByRole('list', { name: 'Import rules' }).evaluate((list) => {
    const found: string[] = []
    for (let element = list.parentElement; element && element.tagName !== 'SECTION'; element = element.parentElement) {
      if (getComputedStyle(element).overflowY === 'hidden' && element.scrollHeight > element.clientHeight + 1) {
        found.push(element.className)
      }
    }
    return found
  })
  expect(scrollableAround).toEqual([])

  // Reaching the last loaded row scrolls the list to its end and reads the next page. That read is held
  // here so the tenth rule is the last one loaded while more wait on the server
  let releasePage: () => void = () => undefined
  const pageHeld = new Promise<void>((resolve) => {
    releasePage = resolve
  })
  let nextPageAsked = false
  await page.route(`**/import-rules?limit=${RULE_PAGE_SIZE}&offset=${RULE_PAGE_SIZE}`, async (route) => {
    nextPageAsked = true
    await pageHeld
    await route.continue().catch(() => undefined)
  })

  // Move down sends the tenth rule past the loaded rows, to the server's eleventh place. The menu is opened once
  // the tenth row is in the middle of the window, the read for the next page is under way and the row has stopped
  // moving
  const tenth = names[9]
  const tenthRow = section.getByRole('listitem').filter({ hasText: tenth })
  await settleRow(tenthRow)
  await expect.poll(() => nextPageAsked).toBe(true)
  await holdStill(tenthRow)
  await (await openRowMenu(page, section, tenth)).getByRole('menuitem', { name: 'Move down' }).click()
  const afterMove = [...names.slice(0, 9), names[10], names[9], ...names.slice(11)]
  await expect.poll(() => readOrder(request, user)).toEqual(afterMove)
  releasePage()

  // Every loaded page is read again, so the tenth place shows the rule that took it, and no rule shows twice
  await expect
    .poll(async () => {
      const shown = await readShownOrder(section, names)
      return shown.length >= RULE_PAGE_SIZE && shown.join() === afterMove.slice(0, shown.length).join()
    })
    .toBe(true)

  await showRules(section, PAGED_RULE_COUNT)
  expect(await readShownOrder(section, names)).toEqual(afterMove)

  // A delete in a paged list closes the gap, and a later page neither repeats a rule nor skips one. The menu is
  // opened once the list is still, and it stays open: nothing in the list or the page scrolls it away
  const firstRow = section.getByRole('listitem').filter({ hasText: names[0] })
  await page.waitForLoadState('networkidle')
  await settleRow(firstRow)
  const menu = await openRowMenu(page, section, names[0])
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Delete' }).click()
  await section.getByRole('button', { name: `Confirm delete ${names[0]}`, exact: true }).click()
  const afterDelete = afterMove.slice(1)
  await expect.poll(() => readOrder(request, user)).toEqual(afterDelete)
  await expect.poll(() => readShownOrder(section, names)).toEqual(afterDelete)
  await page.reload()
  await expect(section.getByRole('status', { name: 'Loading import rules' })).toHaveCount(0)
  await showRules(section, afterDelete.length)
  expect(await readShownOrder(section, names)).toEqual(afterDelete)
})

test('puts the order back and says why when the server refuses a move', AT_EVERY_SIZE, async ({ page, request }) => {
  const { user, names, section } = await openThreeRules(page, request)
  const [alpha, beta, gamma] = names

  await page.route('**/import-rules/*/position', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Import rule not found' }) }),
  )
  await (await openRowMenu(page, section, alpha)).getByRole('menuitem', { name: 'Move down' }).click()

  await expect(section.getByRole('alert').filter({ hasText: 'Import rule not found' })).toBeVisible()
  await expect.poll(() => readShownOrder(section, names)).toEqual([alpha, beta, gamma])
  expect(await readOrder(request, user)).toEqual([alpha, beta, gamma])
})

test('leaves a rule where it is when a disabled move is pressed or entered', async ({ page, request }) => {
  const { user, names, section } = await openThreeRules(page, request)
  const [alpha, beta, gamma] = names

  const menu = await openRowMenu(page, section, alpha)
  const moveUp = menu.getByRole('menuitem', { name: 'Move up' })
  await expect(moveUp).toHaveAttribute('aria-disabled', 'true')
  // The press is forced past the actionability wait, since it treats an unavailable item as not enabled
  await moveUp.click({ force: true })
  await expect(moveUp).toHaveAttribute('aria-disabled', 'true')

  await moveUp.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await expect(moveUp).toBeFocused()

  // The order is read after presses that would each have sent a move, so a missing one is a real absence
  await expect(section.getByRole('listitem')).toHaveCount(3)
  expect(await readOrder(request, user)).toEqual([alpha, beta, gamma])
  await expect.poll(() => readShownOrder(section, names)).toEqual([alpha, beta, gamma])
})

test('moves through a row menu with the arrow keys, Home and End, and Escape returns to the trigger', async ({ page, request }) => {
  const { names, section } = await openThreeRules(page, request)
  const [, beta] = names

  const menu = await openRowMenu(page, section, beta)
  const item = (name: string) => menu.getByRole('menuitem', { name, exact: true })
  await expect(item('Edit')).toBeFocused()

  await page.keyboard.press('ArrowDown')
  await expect(item('Move up')).toBeFocused()
  await page.keyboard.press('End')
  await expect(item('Delete')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(item('Edit')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(item('Delete')).toBeFocused()
  await page.keyboard.press('Home')
  await expect(item('Edit')).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(section.getByRole('button', { name: `Actions for ${beta}`, exact: true })).toBeFocused()
})

const BLOCKING_RECORDS = [
  { noun: 'category', path: 'categories', section: '#categories', data: { kind: 'expense' } },
  { noun: 'tag', path: 'tags', section: '#tags', data: {} },
] as const

for (const record of BLOCKING_RECORDS) {
  test(`names the rule that blocks deleting a ${record.noun}, and a replacement takes the rule over`, async ({ page, request }) => {
    const user = await signUpUser(request)
    const suffix = crypto.randomUUID().slice(0, 8)
    const usedName = `Used ${suffix}`
    const replacementName = `Replacement ${suffix}`
    const made: string[] = []
    for (const name of [usedName, replacementName]) {
      const response = await request.post(`${API_BASE_URL}/${record.path}`, { headers: asUser(user), data: { name, ...record.data } })
      expect(response.status()).toBe(201)
      made.push(((await response.json()) as { id: string }).id)
    }
    const [used, replacement] = made
    const action = record.noun === 'tag' ? { tag_ids: [used] } : { category_id: used }
    const created = await request.post(`${API_BASE_URL}/import-rules`, {
      headers: asUser(user),
      data: {
        name: `Market ${suffix}`,
        match: 'all',
        conditions: [{ kind: 'condition', attribute: 'description', operator: 'contains', value: 'market' }],
        ...action,
      },
    })
    expect(created.status()).toBe(201)

    await logInViaApi(page, user)
    await openPage(page, `/settings${record.section}`)
    const records = page.locator(record.section)
    // The categories are listed in collapsed groups, so the one used is found by its name and its group opened
    if (record.noun === 'category') {
      await records.getByPlaceholder('Search categories...').fill(usedName)
      await records.getByRole('button', { name: /^Expense/ }).click()
    }
    await records.getByRole('button', { name: `Delete ${usedName}`, exact: true }).click()
    await records.getByRole('button', { name: `Confirm delete ${usedName}`, exact: true }).click()

    const dialog = page.getByRole('dialog', { name: 'Choose a replacement first' })
    await expect(dialog).toContainText(
      `${record.noun === 'tag' ? 'Tag' : 'Category'} is used by the import rule "Market ${suffix}". Please choose another ${record.noun} to take its place, then you can delete it.`,
    )
    await expect(dialog).not.toContainText('transactions')
    await chooseFromDropdown(dialog, `Replacement ${record.noun}`, replacementName)
    await dialog.getByRole('button', { name: 'Replace & Delete', exact: true }).click()
    await expect(dialog).toHaveCount(0)

    const [rule] = await readRules(request, user)
    const set = rule as unknown as { category: { id: string } | null; tags: Array<{ id: string }> }
    expect(record.noun === 'tag' ? set.tags[0]?.id : set.category?.id).toBe(replacement)
  })
}

test('shows each refusal of a save where it belongs in the editor', async ({ page, request }) => {
  const user = await signUpUser(request)
  const suffix = crypto.randomUUID().slice(0, 8)
  const merchantName = `Merchant ${suffix}`
  const merchantId = await createMerchant(request, user, merchantName)
  await createRule(request, user, `Taken ${suffix}`, merchantId)

  await logInViaApi(page, user)
  await openPage(page, '/settings#import-rules')
  const section = page.locator('#import-rules')
  await expect(section.getByRole('status', { name: 'Loading import rules' })).toHaveCount(0)
  await section.getByRole('button', { name: 'Create rule', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create rule' })
  const create = dialog.getByRole('button', { name: 'Create rule', exact: true })
  await chooseFromDropdown(dialog, 'Set merchant', merchantName)

  // An account condition with no account chosen is refused on its own row
  await chooseFromDropdown(dialog, 'Condition 1 attribute', 'Account')
  await dialog.getByRole('textbox', { name: 'Rule name', exact: true }).fill(`taken ${suffix}`)
  await create.click()
  await expect(dialog.getByRole('alert').filter({ hasText: 'Select an account' })).toBeVisible()

  // A name another rule has, whatever its capitals, is refused on the name
  await chooseFromDropdown(dialog, 'Condition 1 attribute', 'Description')
  await dialog.getByRole('textbox', { name: 'Condition 1 value', exact: true }).fill('market')
  await create.click()
  await expect(dialog.getByRole('alert').filter({ hasText: 'An import rule with this name already exists' })).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Rule name', exact: true })).toHaveAttribute('aria-invalid', 'true')

  // A refusal that is not about the name shows as the form's own error, with the next step
  await page.route('**/import-rules', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Your import rules or the records they name changed meanwhile. Please try again.' }),
        })
      : route.fallback(),
  )
  await dialog.getByRole('textbox', { name: 'Rule name', exact: true }).fill(`Fresh ${suffix}`)
  await create.click()
  const formError = dialog.getByRole('alert').filter({ hasText: 'Your import rules or the records they name changed meanwhile. Please try again.' })
  await expect(formError).toContainText('Please check what the rule sets and try again.')
  await expect(dialog.getByRole('textbox', { name: 'Rule name', exact: true })).not.toHaveAttribute('aria-invalid', 'true')
  expect(await readOrder(request, user)).toEqual([`Taken ${suffix}`])
})

/** Signs a user up with a merchant and one saved rule the callback makes, returning the rule's name */
async function openSavedRule(
  request: APIRequestContext,
  make: (user: TestUser, name: string, merchantId: string) => Promise<void>,
) {
  const user = await signUpUser(request)
  const suffix = crypto.randomUUID().slice(0, 8)
  const name = `Saved ${suffix}`
  const merchantId = await createMerchant(request, user, `Merchant ${suffix}`)
  await make(user, name, merchantId)
  return { user, name, merchantId }
}

async function openSection(page: Page, user: TestUser) {
  await logInViaApi(page, user)
  await openPage(page, '/settings#import-rules')
  const section = page.locator('#import-rules')
  await expect(section.getByRole('status', { name: 'Loading import rules' })).toHaveCount(0)
  return section
}

test('starts a saved condition switched to Amount in the base currency, with its amount open to type in', async ({ page, request }) => {
  const { user, name } = await openSavedRule(request, async (owner, ruleName, merchantId) =>
    createRule(request, owner, ruleName, merchantId),
  )
  const section = await openSection(page, user)
  await openRuleEditor(section, name)
  const dialog = page.getByRole('dialog', { name: 'Edit rule' })

  await chooseFromDropdown(dialog, 'Condition 1 attribute', 'Amount')
  const amount = dialog.getByRole('textbox', { name: 'Condition 1 amount', exact: true })
  await expect(amount).toBeEnabled()
  await expect(amount).not.toHaveAttribute('aria-busy', 'true')
  await expect(dialog.getByRole('combobox', { name: 'Condition 1 currency' })).toContainText('CAD')

  // A refused save puts focus on the amount, and the amount takes it
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.getByRole('alert').filter({ hasText: 'Enter an amount' })).toBeVisible()
  await expect(amount).toHaveAttribute('aria-invalid', 'true')
  await expect(amount).toBeFocused()

  await amount.fill('12.50')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const [rule] = await readRules(request, user)
  expect(rule.name).toBe(name)
  expect(rule).toMatchObject({ conditions: [{ attribute: 'amount', operator: 'at_least', value: 1250, currency: 'CAD' }] })
})

test('changes layout together in a top condition and one in a group, at every width', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#import-rules')
  await page.locator('#import-rules').getByRole('button', { name: 'Create rule', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create rule' })
  await dialog.getByRole('button', { name: 'Add group', exact: true }).click()

  // Whether the operator and the value sit on the attribute's line: all three on one line, the value under the
  // other two, or each field on a line of its own
  const layoutOf = async (prefix: string) => {
    const top = async (field: Locator) => (await field.boundingBox())!.y
    const attribute = await top(dialog.getByRole('combobox', { name: new RegExp(`^${prefix} attribute\\b`) }))
    const operator = await top(dialog.getByRole('combobox', { name: new RegExp(`^${prefix} operator\\b`) }))
    const value = await top(dialog.getByRole('textbox', { name: `${prefix} value`, exact: true }))
    return `${Math.abs(operator - attribute) < 2 ? 'operator beside' : 'operator under'}, ${Math.abs(value - attribute) < 2 ? 'value beside' : 'value under'}`
  }
  const seen = new Set<string>()
  for (let width = 480; width <= 960; width += 4) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    const top = await layoutOf('Condition 1')
    expect(await layoutOf('Group 1 condition 1'), `a group's row at ${width}px wide`).toBe(top)
    seen.add(top)
  }
  // The widths cover every layout, so the comparison reached each place the layout changes
  expect([...seen].sort()).toEqual(['operator beside, value beside', 'operator beside, value under', 'operator under, value under'])
})

test('shows an amount the server refuses on its own row, in a group too, and takes the largest it stores', async ({ page, request }) => {
  // The field tidies an amount to its currency's decimal places as it is typed and as the currency changes, so the
  // one amount it lets through for the server to refuse is one past the largest the server stores
  const user = await signUpUser(request)
  const suffix = crypto.randomUUID().slice(0, 8)
  const merchantName = `Merchant ${suffix}`
  await createMerchant(request, user, merchantName)
  await logInViaApi(page, user)
  await openPage(page, '/settings#import-rules')
  await page.locator('#import-rules').getByRole('button', { name: 'Create rule', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create rule' })
  const create = dialog.getByRole('button', { name: 'Create rule', exact: true })
  await dialog.getByRole('textbox', { name: 'Rule name', exact: true }).fill(`Large ${suffix}`)
  await chooseFromDropdown(dialog, 'Set merchant', merchantName)
  await dialog.getByRole('button', { name: 'Add group', exact: true }).click()
  // Matched from its start, since "Condition 1 attribute" is also part of the name of the row in the group
  await dialog.getByRole('combobox', { name: /^Condition 1 attribute\b/ }).click()
  await dialog.getByRole('option', { name: 'Amount' }).click()
  // The list that was open finishes closing before the next one opens, so two never answer to one name
  await expect(dialog.getByRole('option', { name: 'Amount' })).toHaveCount(0)
  await chooseFromDropdown(dialog, 'Group 1 condition 1 attribute', 'Amount')

  // An amount one past the largest the server stores, on the top row and on the row in the group, each refused on
  // its own row
  const top = dialog.getByRole('textbox', { name: 'Condition 1 amount', exact: true })
  const inner = dialog.getByRole('textbox', { name: 'Group 1 condition 1 amount', exact: true })
  await top.fill('92233720368547758.08')
  await inner.fill('92233720368547758.08')
  await create.click()
  await expect(top).toHaveAttribute('aria-invalid', 'true')
  await expect(inner).toHaveAttribute('aria-invalid', 'true')
  await expect(top).toBeFocused()
  expect(await readRules(request, user)).toEqual([])

  // The largest the server stores is taken as typed, and the field never tidies it into another figure
  await top.fill('1.00')
  await inner.fill('92233720368547758.07')
  await inner.blur()
  await expect(inner).toHaveValue('92233720368547758.07')
  await create.click()
  await expect(dialog).toHaveCount(0)
  const stored = await (await request.get(`${API_BASE_URL}/import-rules?limit=50&offset=0`, { headers: asUser(user) })).text()
  expect(stored).toContain('"value":9223372036854775807')
})

test('shows a refusal of an edit that is not about the name as the editor own error, with the next step', async ({ page, request }) => {
  const { user, name } = await openSavedRule(request, async (owner, ruleName, merchantId) =>
    createRule(request, owner, ruleName, merchantId),
  )
  const section = await openSection(page, user)
  await page.route('**/import-rules/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Your import rules or the records they name changed meanwhile. Please try again.' }),
        })
      : route.fallback(),
  )
  await openRuleEditor(section, name)
  const dialog = page.getByRole('dialog', { name: 'Edit rule' })
  await dialog.getByRole('textbox', { name: 'Rule name', exact: true }).fill(`${name} again`)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()

  const formError = dialog.getByRole('alert').filter({ hasText: 'Your import rules or the records they name changed meanwhile. Please try again.' })
  await expect(formError).toContainText('Please check what the rule sets and try again.')
  await expect(dialog.getByRole('textbox', { name: 'Rule name', exact: true })).not.toHaveAttribute('aria-invalid', 'true')
  expect(await readOrder(request, user)).toEqual([name])
})

test('keeps the order when a rule is dragged from the first page to the second', async ({ page, request }) => {
  const { user, names, section } = await openPagedRules(page, request)
  await showRules(section, PAGED_RULE_COUNT)

  // The keyboard picks the second rule up and carries it down past the tenth, onto the second page
  const moved = names[1]
  const grip = section.getByRole('button', { name: `Move ${moved}`, exact: true })
  await grip.focus()
  await page.keyboard.press('Space')
  await expectPickedUp(page, moved)
  const heldRow = section.getByRole('listitem').filter({ hasText: moved })
  for (let place = 3; place <= 13; place++) {
    await page.keyboard.press('ArrowDown')
    await expect(page.getByText(`${moved} is now over number ${place} of ${PAGED_RULE_COUNT}`)).toBeAttached()
    // Near the list's end the library scrolls the box to bring the next rule into view, and an arrow key pressed while
    // that scroll is under way moves nothing. The next key waits until the held row has stopped
    await holdStill(heldRow)
  }
  await page.keyboard.press('Space')

  const afterDrop = names.filter((name) => name !== moved)
  afterDrop.splice(12, 0, moved)
  await expect.poll(() => readOrder(request, user)).toEqual(afterDrop)
  await expect.poll(() => readShownOrder(section, names)).toEqual(afterDrop)
})

/** Whether a computed colour is a solid one: not `transparent` and with no alpha below one */
function isSolid(color: string): boolean {
  if (color === 'transparent') return false
  // `rgb(r g b / a)` and `color(srgb r g b / a)` carry the alpha after a slash, `rgba(r, g, b, a)` as a fourth channel
  const slash = color.match(/\/\s*([\d.]+)(%?)\s*\)$/)
  if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1) === 1
  const channels = color.match(/^rgba?\(([^)]*)\)$/)?.[1].split(',')
  return !channels || channels.length < 4 || Number(channels[3]) === 1
}

/** A colour with a whole alpha written as the plain one, so the same colour from two sources reads the same */
function plainColour(color: string): string {
  return color.replace(/^rgba\((\d+), (\d+), (\d+), 1\)$/, 'rgb($1, $2, $3)')
}

/** Waits until the element's own surface is solid, once the lift's fade has run, and returns the colour */
async function solidSurfaceOf(row: Locator): Promise<string> {
  const read = () => row.evaluate((element) => getComputedStyle(element).backgroundColor)
  await expect.poll(async () => isSolid(await read()), { message: 'a held row has a solid surface of its own' }).toBe(true)
  return plainColour(await read())
}

/**
 * Presses Tab from a place the click sets, until the control with this name has focus. A click on a heading
 * sets where Tab starts and focuses nothing, so the grip is reached the way a person reaches it
 */
async function tabTo(page: Page, name: string, startAt: Locator) {
  await startAt.click()
  for (let presses = 0; presses < 40; presses++) {
    await page.keyboard.press('Tab')
    if ((await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === name) return
  }
  throw new Error(`Tab never reached "${name}"`)
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`draws a rule held by the keyboard or the mouse on a surface of its own in the ${colorScheme} theme`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme })
    const { names, section } = await openThreeRules(page, request)
    const [alpha, beta] = names
    await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
    const rowOf = (name: string) => section.getByRole('listitem').filter({ hasText: name })
    const heading = section.getByRole('heading', { level: 2, name: 'Import rules', exact: true })

    // The rows beside a held row never show through it, so a rule at rest has no surface and a held one has the card's
    const surfaceAtRest = await rowOf(beta).evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(isSolid(surfaceAtRest)).toBe(false)

    await tabTo(page, `Move ${alpha}`, heading)
    await page.keyboard.press('Space')
    await expect(page.getByText(`Picked up ${alpha}`)).toBeAttached()
    const byKeyboard = await solidSurfaceOf(rowOf(alpha))
    expect(await rowOf(alpha).evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none')

    // Rows slide aside in the app's duration and curve, not the drag library's own 200 ms
    await page.keyboard.press('ArrowDown')
    await expect(page.getByText(`${alpha} is now over number 2 of 3`)).toBeAttached()
    expect(await rowOf(beta).evaluate((element) => (element as HTMLElement).style.transition)).toContain(
      '300ms cubic-bezier(0.22, 1, 0.36, 1)',
    )
    await page.keyboard.press('Escape')
    await expect(page.getByText(`Cancelled. ${alpha} stays`)).toBeAttached()

    const grip = section.getByRole('button', { name: `Move ${beta}`, exact: true })
    const box = (await grip.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 12, { steps: 4 })
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 24, { steps: 4 })
    const byMouse = await solidSurfaceOf(rowOf(beta))
    expect(await rowOf(beta).evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none')
    await page.keyboard.press('Escape')
    await page.mouse.up()

    // A row on the card takes the card's own colour, and the same one by either way of holding it
    expect(byMouse).toBe(byKeyboard)
    // The card is the nearest box around the list that paints a surface of its own
    const list = section.getByRole('list', { name: 'Import rules', exact: true })
    const cardColour = await list.evaluate((element) => {
      let box = element.parentElement
      while (box && /^rgba\(\d+, \d+, \d+, 0\)$|^transparent$/.test(getComputedStyle(box).backgroundColor)) box = box.parentElement
      return box ? getComputedStyle(box).backgroundColor : ''
    })
    expect(byKeyboard).toBe(plainColour(cardColour))
  })

  test(`draws a condition held by the keyboard or the mouse on a surface of its own in the editor in the ${colorScheme} theme`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme })
    const user = await signUpUser(request)
    await logInViaApi(page, user)
    await openPage(page, '/settings#import-rules')
    await page.locator('#import-rules').getByRole('button', { name: 'Create rule', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Create rule' })
    await dialog.getByRole('button', { name: 'Add condition', exact: true }).first().click()
    await expect(dialog.getByRole('textbox', { name: 'Condition 2 value', exact: true })).toBeVisible()
    const rowOf = (name: string) => dialog.getByRole('button', { name, exact: true }).locator('xpath=ancestor::li[1]')

    await tabTo(page, 'Move condition 1', dialog.getByRole('heading', { name: 'Create rule' }))
    await page.keyboard.press('Space')
    await expect(page.getByText('Picked up Condition 1')).toBeAttached()
    const byKeyboard = await solidSurfaceOf(rowOf('Move condition 1'))
    expect(await rowOf('Move condition 1').evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none')
    await page.keyboard.press('Space')
    await expect(page.getByText('Dropped Condition 1')).toBeAttached()

    const grip = dialog.getByRole('button', { name: 'Move condition 2', exact: true })
    const box = (await grip.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 12, { steps: 4 })
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 20, { steps: 4 })
    const byMouse = await solidSurfaceOf(rowOf('Move condition 2'))
    expect(await rowOf('Move condition 2').evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none')
    await page.mouse.up()

    // The dialogue's own colour, by either way of holding the row
    expect(byMouse).toBe(byKeyboard)
    expect(byKeyboard).toBe(plainColour(await dialog.evaluate((panel) => getComputedStyle(panel).backgroundColor)))
  })
}

test('lifts a row with one Space after Tab alone reaches its grip, in the list and in the editor', async ({ page, request }) => {
  const { names, section } = await openThreeRules(page, request)
  const [alpha] = names
  await tabTo(page, `Move ${alpha}`, section.getByRole('heading', { level: 2, name: 'Import rules', exact: true }))
  const grip = section.getByRole('button', { name: `Move ${alpha}`, exact: true })
  await expect(grip).toBeFocused()
  await page.keyboard.press('Space')
  await expect(grip).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(`Picked up ${alpha}`)).toBeAttached()
  await page.keyboard.press('Escape')

  await section.getByRole('button', { name: 'Create rule', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create rule' })
  await dialog.getByRole('button', { name: 'Add condition', exact: true }).first().click()
  await expect(dialog.getByRole('textbox', { name: 'Condition 2 value', exact: true })).toBeVisible()
  await tabTo(page, 'Move condition 2', dialog.getByRole('heading', { name: 'Create rule' }))
  const conditionGrip = dialog.getByRole('button', { name: 'Move condition 2', exact: true })
  await expect(conditionGrip).toBeFocused()
  await page.keyboard.press('Space')
  await expect(conditionGrip).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Picked up Condition 2')).toBeAttached()
})

test('clears "Name is required" as the name is typed, as the Create merchant dialogue clears its own', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#merchants')
  await page.locator('#merchants').getByRole('button', { name: 'Create merchant', exact: true }).click()
  const merchantDialog = page.getByRole('dialog', { name: 'Create merchant' })
  await merchantDialog.getByRole('button', { name: 'Create merchant', exact: true }).click()
  const merchantError = merchantDialog.getByRole('alert').filter({ hasText: /required/i })
  await expect(merchantError).toBeVisible()
  await merchantDialog.getByRole('textbox', { name: 'Merchant name' }).pressSequentially('C')
  await expect(merchantError).toHaveCount(0)
  await merchantDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(merchantDialog).toHaveCount(0)

  await openPage(page, '/settings#import-rules')
  await page.locator('#import-rules').getByRole('button', { name: 'Create rule', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create rule' })
  await dialog.getByRole('button', { name: 'Create rule', exact: true }).click()
  const nameError = dialog.getByRole('alert').filter({ hasText: 'Name is required' })
  await expect(nameError).toBeVisible()
  // Typed as a person types it, one key at a time. The message goes with the first letter, with no other field clicked
  const name = dialog.getByRole('textbox', { name: 'Rule name', exact: true })
  await name.click()
  await name.pressSequentially('G')
  await expect(nameError).toHaveCount(0)
  await expect(name).not.toHaveAttribute('aria-invalid', 'true')
  await name.pressSequentially('roceries')
  await expect(name).toHaveValue('Groceries')
})

/** Reads a box until it has stayed the same on enough reads in a row, so nothing is still moving it */
async function settledBox(target: Locator) {
  let last = ''
  let reads = 0
  await expect
    .poll(
      async () => {
        const box = await target.boundingBox()
        const now = box ? `${box.x},${box.y},${box.width},${box.height}` : ''
        reads = now !== '' && now === last ? reads + 1 : 0
        last = now
        return reads
      },
      { intervals: [100] },
    )
    .toBeGreaterThanOrEqual(5)
  return (await target.boundingBox())!
}

for (const unavailable of [
  { rule: 0, item: 'Move up', reason: 'This rule is already first', arrowsFromEdit: 1 },
  { rule: 2, item: 'Move down', reason: 'This rule is already last', arrowsFromEdit: 2 },
]) {
  test(`shows the reason of the unavailable ${unavailable.item} beside its item, in one place on hover, focus and press, with a whole ring on the item`, AT_EVERY_SIZE, async ({ page, request }) => {
    const { names, section } = await openThreeRules(page, request)
    // The row sits in the middle of the window first, since a menu closes when the page scrolls to reveal its button
    await settleRow(section.getByRole('listitem').filter({ hasText: names[unavailable.rule] }))
    const menu = await openRowMenu(page, section, names[unavailable.rule])
    const item = menu.getByRole('menuitem', { name: unavailable.item })
    const edit = menu.getByRole('menuitem', { name: 'Edit' })
    // Every grip carries a tooltip of its own, so the one drawn for this reason is found by its words
    const reason = page.getByTestId('disabled-reason-tooltip').filter({ hasText: unavailable.reason })
    const shown = async () => {
      await expect(reason).toHaveCSS('opacity', '1')
      return settledBox(reason)
    }
    const menuBox = await settledBox(menu)
    const itemBox = await settledBox(item)
    const otherItems = await menu.getByRole('menuitem').filter({ hasNot: item }).all()

    // The pointer over the item
    await item.hover()
    const hovered = await shown()
    await page.mouse.move(2, 2)
    await expect(reason).toHaveCount(0)

    // The keyboard on the item, with the ring drawn inside its edge on all four sides, as an available item draws it
    await expect(edit).toBeFocused()
    for (let step = 0; step < unavailable.arrowsFromEdit; step += 1) await page.keyboard.press('ArrowDown')
    await expect(item).toBeFocused()
    const focused = await shown()
    await expect(item).toHaveCSS('outline-offset', '-2px')
    await expect(item).toHaveCSS('outline-style', 'solid')
    await expect(item).toHaveCSS('outline-width', '2px')
    await edit.focus()
    await expect(edit).toBeFocused()
    await expect(edit).toHaveCSS('outline-offset', '-2px')

    // The press
    await item.hover()
    await page.mouse.down()
    const pressed = await shown()
    await page.mouse.up()

    for (const [place, box] of [
      ['hover', hovered],
      ['focus', focused],
      ['press', pressed],
    ] as const) {
      expect(Math.abs(box.x - focused.x), `${place} left edge`).toBeLessThan(1)
      expect(Math.abs(box.y - focused.y), `${place} top edge`).toBeLessThan(1)
      // Beside the item on the side with room. The menu hangs from a row's right end, so that side is its left
      expect(box.x + box.width, `the reason on ${place} ends left of the menu`).toBeLessThanOrEqual(menuBox.x)
      expect(Math.abs(itemBox.x - (box.x + box.width) - 10), `the reason on ${place} is one gap from the item`).toBeLessThan(1)
      // Level with the item, so it reads as the item's own
      const middle = box.y + box.height / 2
      expect(middle, `the reason on ${place} is below the item's top`).toBeGreaterThanOrEqual(itemBox.y)
      expect(middle, `the reason on ${place} is above the item's bottom`).toBeLessThanOrEqual(itemBox.y + itemBox.height)
      expect(Math.abs(middle - (itemBox.y + itemBox.height / 2)), `the reason on ${place} is level with the item`).toBeLessThan(1)
      // And over no item and not the menu
      const overlaps = (other: { x: number; y: number; width: number; height: number }) =>
        box.x < other.x + other.width &&
        box.x + box.width > other.x &&
        box.y < other.y + other.height &&
        box.y + box.height > other.y
      expect(overlaps(menuBox), `the reason on ${place} covers no part of the menu`).toBe(false)
      expect(overlaps(itemBox), `the reason on ${place} covers its item`).toBe(false)
      for (const other of otherItems) expect(overlaps((await other.boundingBox())!), `the reason on ${place} covers an item`).toBe(false)
    }
  })
}

test('keeps a long summary still, with its start showing, and slides it only for a pointer over its button or keyboard focus', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const merchantId = await createMerchant(request, user, 'Corner Market')
  const response = await request.post(`${API_BASE_URL}/import-rules`, {
    headers: asUser(user),
    data: {
      name: 'Long summary',
      match: 'all',
      // A typed value is cut at 40 letters in the sentence, so six of them make a sentence too long for any row
      conditions: Array.from({ length: 6 }, (_, index) => ({
        kind: 'condition',
        attribute: index % 2 === 0 ? 'description' : 'note',
        operator: 'contains',
        value: 'Y'.repeat(40),
      })),
      merchant_id: merchantId,
      tag_ids: [],
    },
  })
  expect(response.status()).toBe(201)
  await createRule(request, user, 'Short summary', merchantId)
  await logInViaApi(page, user)
  await openPage(page, '/settings#import-rules')
  const section = page.locator('#import-rules')
  await expect(section.getByRole('listitem')).toHaveCount(2)
  await bringToRest(page, section)

  const long = section.getByRole('listitem').filter({ hasText: 'Long summary' })
  const opener = long.getByRole('button', { name: /^Long summary\s/ })

  // The sentence's box is the one the button marks with data-overflow. Its copy at rest is the one child a screen
  // reader hears, and its sliding copy is the last of its hidden children, after the one that measures the text
  const summary = opener.locator('[data-overflow]')
  const track = summary.locator(':scope > [aria-hidden="true"]').last()
  // The slide is a keyframe animation. The sliding copy's fade in is a transition and doesn't count
  const sliding = () => track.evaluate((element) => element.getAnimations().some((animation) => animation instanceof CSSAnimation))

  // Below 750px the sentence wraps instead and nothing slides, however the button is hovered or focused
  if ((page.viewportSize()?.width ?? 0) < 750) {
    await expect(summary).toBeHidden()
    await page.mouse.move(2, 2)
    await opener.hover()
    await opener.focus()
    expect((await readSentence(long)).animations).toBe(0)
    return
  }
  await expect(summary).toHaveAttribute('data-overflow', 'true')

  // At rest the line is cut by an ellipsis, shows its first letter at its own left edge and nothing on it moves
  const atRest = async () =>
    summary.evaluate((element) => {
      const text = element.querySelector(':scope > :not([aria-hidden="true"])')!
      const range = document.createRange()
      range.setStart(text.firstChild!, 0)
      range.setEnd(text.firstChild!, 1)
      return {
        firstGlyphLeft: range.getBoundingClientRect().left - element.getBoundingClientRect().left,
        textOverflow: getComputedStyle(text).textOverflow,
        staticOpacity: getComputedStyle(text).opacity,
        moving: element.querySelector(':scope > [aria-hidden="true"]:last-child')!.getAnimations().length > 0,
      }
    })
  await page.mouse.move(2, 2)
  await expect.poll(atRest).toMatchObject({ textOverflow: 'ellipsis', staticOpacity: '1', moving: false })
  expect(Math.abs((await atRest()).firstGlyphLeft)).toBeLessThan(1)

  // A pointer over the row's button slides it, and it comes to rest when the pointer goes
  if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) {
    await opener.hover()
    await expect.poll(sliding).toBe(true)
    await page.mouse.move(2, 2)
    await expect.poll(atRest).toMatchObject({ moving: false })
  }

  // Keyboard focus on the button slides it too
  await page.mouse.move(2, 2)
  await tabTo(page, 'Move Long summary', section.getByRole('heading', { level: 2, name: 'Import rules', exact: true }))
  await page.keyboard.press('Tab')
  await expect(opener).toBeFocused()
  await expect.poll(sliding).toBe(true)
})

/** What a row's sentence shows: the words drawn, the lines they take and whether the box holds them all */
async function readSentence(row: Locator) {
  return row.evaluate((item) => {
    // The button that opens the editor is the one holding the sliding sentence's box
    const button = item.querySelector<HTMLElement>('button:has([data-overflow])')!
    const shown = Array.from(button.children[2].children).find(
      (part) => !part.getAttribute('aria-hidden') && getComputedStyle(part).display !== 'none',
    ) as HTMLElement
    const style = getComputedStyle(shown)
    return {
      // The sliding sentence's copy at rest is its one child a screen reader hears
      text: (shown.hasAttribute('data-overflow') ? shown.querySelector(':scope > :not([aria-hidden="true"])')! : shown).textContent,
      lines: Math.round(shown.getBoundingClientRect().height / parseFloat(style.lineHeight)),
      cut: shown.scrollHeight > shown.clientHeight + 1,
      heardOnce: Array.from(button.children[2].children).filter(
        (part) => !part.getAttribute('aria-hidden') && getComputedStyle(part).display !== 'none',
      ).length,
      // Only what moves the When line: the row's button may fade its own background on a hover
      animations: button.children[2].getAnimations({ subtree: true }).length,
    }
  })
}

test('wraps the When sentence on at most two lines below 750px, and keeps it on one line from 750px', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const merchantId = await createMerchant(request, user, 'Corner Market')
  await createFullRule(request, user, { name: 'Short', conditions: [descriptionContains('SHELL')], merchantId })
  await createFullRule(request, user, {
    name: 'Longer',
    conditions: [
      {
        kind: 'group',
        match: 'any',
        conditions: Array.from({ length: 6 }, (_, index) => ({
          kind: 'condition',
          attribute: index % 2 === 0 ? 'description' : 'note',
          operator: 'contains',
          value: 'Y'.repeat(40),
        })),
      },
    ],
    merchantId,
  })
  const section = await openSection(page, user)
  await expect(section.getByRole('listitem')).toHaveCount(2)
  await bringToRest(page, section)
  const wide = (page.viewportSize()?.width ?? 0) >= 750
  const row =(name: string) => section.getByRole('listitem').filter({ hasText: name })

  const short = await readSentence(row('Short'))
  const longer = await readSentence(row('Longer'))
  expect(short).toMatchObject({ text: 'Description contains "SHELL"', cut: false, heardOnce: 1 })
  expect(longer.heardOnce).toBe(1)

  if (wide) {
    // One line, the long sentence cut by the marquee's ellipsis
    expect(short.lines).toBe(1)
    expect(longer.lines).toBe(1)
  } else {
    // A sentence that fits in two lines shows whole, a longer one ends within two lines, and nothing slides on a press
    // or on focus
    expect(short.lines).toBe(2)
    expect(longer.lines).toBe(2)
    expect(longer.cut, 'a sentence of more than two lines is cut').toBe(true)
    const opener = row('Longer').getByRole('button', { name: /^Longer\s/ })
    await opener.hover()
    expect((await readSentence(row('Longer'))).animations).toBe(0)
    await page.keyboard.press('Tab')
    await opener.focus()
    await expect(opener).toBeFocused()
    expect((await readSentence(row('Longer'))).animations).toBe(0)
  }

  // The label stays on the first line, in its own narrow column, and what the rule sets stays under the sentence
  if (!wide) {
    const places = await row('Short').evaluate((item) => {
      const button = item.querySelector<HTMLElement>('button:has([data-overflow])')!
      const label = Array.from(button.querySelectorAll('span[aria-hidden="true"]')).find((span) => span.textContent === 'When')!
      const sets = Array.from(button.querySelectorAll('span[aria-hidden="true"]')).find((span) => span.textContent === 'Sets')!
      const sentence = Array.from(button.children[2].children).find((part) => getComputedStyle(part).display !== 'none' && !part.getAttribute('aria-hidden'))!
      return {
        labelTop: label.getBoundingClientRect().top,
        sentenceTop: sentence.getBoundingClientRect().top,
        sentenceBottom: sentence.getBoundingClientRect().bottom,
        setsTop: sets.getBoundingClientRect().top,
        labelRight: label.getBoundingClientRect().right,
        sentenceLeft: sentence.getBoundingClientRect().left,
      }
    })
    expect(Math.abs(places.labelTop - places.sentenceTop)).toBeLessThan(1)
    expect(places.setsTop).toBeGreaterThanOrEqual(places.sentenceBottom)
    expect(places.labelRight).toBeLessThanOrEqual(places.sentenceLeft)
  }
})

test('ends a condition error where its value field ends, at every width', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#import-rules')
  await page.locator('#import-rules').getByRole('button', { name: 'Create rule', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create rule' })
  await dialog.getByRole('button', { name: 'Add group', exact: true }).click()
  await dialog.getByRole('button', { name: 'Create rule', exact: true }).click()
  const errors = dialog.getByRole('alert').filter({ hasText: 'Enter the text to match' })
  await expect(errors).toHaveCount(2)

  const checkEdges = async (width: number) => {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    for (const [row, field] of [
      ['Condition 1 value', dialog.getByRole('textbox', { name: 'Condition 1 value', exact: true })],
      ['Group 1 condition 1 value', dialog.getByRole('textbox', { name: 'Group 1 condition 1 value', exact: true })],
    ] as const) {
      // The field is described by its own error, so the message found by that id is the row's, whichever width it is
      const fieldBox = await settledBox(field)
      const errorId = await field.getAttribute('aria-describedby')
      const errorBox = await settledBox(dialog.locator(`[id="${errorId}"]`))
      expect(Math.abs(errorBox.x + errorBox.width - (fieldBox.x + fieldBox.width)), `${row} error ends on its field at ${width}px`).toBeLessThan(1.5)
    }
  }
  for (const width of [375, 420, 480, 560, 640, 720, 800, 960]) await checkEdges(width)
})

test('lets the list rest after a short scroll down to its end message', async ({ page, request }) => {
  const { section } = await openPagedRules(page, request)
  await showRules(section, PAGED_RULE_COUNT)
  const list = section.getByRole('list', { name: 'Import rules' })
  const scroller = list.locator('xpath=ancestor::div[contains(@class, "overflow-y-auto")][1]')
  await scroller.evaluate((element) => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }))
  await expect(section.getByText("You've reached the end.")).toBeVisible()

  // The end message adds its own height below the last row, so the list is short of its new end. A short scroll
  // down that stops before that end takes the message away, the list shortens and the browser puts it back at
  // its end, where the message returns. A shift of the content on every such change turned that into a loop that
  // scrolled the list for ever
  const scrolls = await scroller.evaluateHandle((element) => {
    const counter = { count: 0 }
    element.addEventListener('scroll', () => (counter.count += 1))
    return counter
  })
  const box = await scroller.boundingBox()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.wheel(0, 28)
  // Thirty frames is longer than the few changes the list makes on its way to rest
  await page.evaluate(async () => {
    for (let frame = 0; frame < 30; frame += 1) await new Promise((done) => requestAnimationFrame(done))
  })
  expect(await scrolls.evaluate((counter) => counter.count)).toBeLessThan(5)
})

// Where keyboard focus sits after an action in a row's menu or its delete confirmation. A person who moves, edits
// or deletes with the keyboard must never find focus dropped on the page body, since the next Tab then starts again
// from the top of the page. Every test reads focus twice: at once after the action, and again after the list has
// settled and the server has answered, since the rows are drawn again then

/** Where focus is, as the name a person hears for it, or "the page body" */
async function readFocus(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement
    if (!element || element === document.body) return 'the page body'
    return element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName
  })
}

const MENU_ITEMS = ['Edit', 'Move up', 'Move down', 'Delete'] as const

/** Opens a row's menu from its button and chooses an item, with the keyboard alone */
async function chooseWithKeyboard(
  page: Page,
  section: Locator,
  ruleName: string,
  item: (typeof MENU_ITEMS)[number],
  rowIsSettled = false,
) {
  // A row the test has already brought to rest is not scrolled again. A second scroll reads the next page a second time
  if (!rowIsSettled) await settleRow(section.getByRole('listitem').filter({ hasText: ruleName }))
  await section.getByRole('button', { name: `Actions for ${ruleName}`, exact: true }).focus()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu', { name: `Actions for ${ruleName}` })
  await expect(menu.getByRole('menuitem', { name: 'Edit', exact: true })).toBeFocused()
  for (let step = 0; step < MENU_ITEMS.indexOf(item); step += 1) await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: item, exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
}

/** Waits until nothing is in flight and the shown rows have stopped changing, then reads focus once more */
async function readFocusOnceSettled(page: Page, section: Locator) {
  await page.waitForLoadState('networkidle')
  const first = section.getByRole('listitem').first()
  if ((await first.count()) > 0) await holdStill(first)
  return readFocus(page)
}

/** Signs a user in with `count` rules named Rule A, Rule B and so on, and opens the section */
async function openRules(page: Page, request: APIRequestContext, count: number) {
  const user = await signUpUser(request)
  const suffix = crypto.randomUUID().slice(0, 8)
  const names = ['A', 'B', 'C', 'D'].slice(0, count).map((letter) => `Rule ${letter} ${suffix}`)
  const merchantId = await createMerchant(request, user, `Merchant ${suffix}`)
  for (const name of names) await createRule(request, user, name, merchantId)
  await logInViaApi(page, user)
  await openPage(page, '/settings#import-rules')
  const section = page.locator('#import-rules')
  await expect(section.getByRole('status', { name: 'Loading import rules' })).toHaveCount(0)
  await expect(section.getByRole('listitem')).toHaveCount(count)
  await bringToRest(page, section)
  return { user, names, section }
}

test('keeps focus on the moved rule\'s Actions button after Move down and Move up from the keyboard', AT_EVERY_SIZE, async ({ page, request }) => {
  const { user, names, section } = await openThreeRules(page, request)
  const [alpha, beta, gamma] = names
  const actions = `Actions for ${beta}`

  await chooseWithKeyboard(page, section, beta, 'Move down')
  expect(await readFocus(page), 'at once after Move down').toBe(actions)
  await expect.poll(() => readOrder(request, user)).toEqual([alpha, gamma, beta])
  await expect.poll(() => readShownOrder(section, names)).toEqual([alpha, gamma, beta])
  expect(await readFocusOnceSettled(page, section), 'settled after Move down').toBe(actions)

  await chooseWithKeyboard(page, section, beta, 'Move up')
  expect(await readFocus(page), 'at once after Move up').toBe(actions)
  await expect.poll(() => readOrder(request, user)).toEqual([alpha, beta, gamma])
  await expect.poll(() => readShownOrder(section, names)).toEqual([alpha, beta, gamma])
  expect(await readFocusOnceSettled(page, section), 'settled after Move up').toBe(actions)
})

test('keeps focus on the rule\'s Actions button when the server refuses a move and the order goes back', AT_EVERY_SIZE, async ({ page, request }) => {
  const { names, section } = await openThreeRules(page, request)
  const [alpha, beta, gamma] = names
  await page.route('**/import-rules/*/position', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Import rule not found' }) }),
  )

  await chooseWithKeyboard(page, section, alpha, 'Move down')
  expect(await readFocus(page), 'at once').toBe(`Actions for ${alpha}`)
  await expect(section.getByRole('alert').filter({ hasText: 'Import rule not found' })).toBeVisible()
  await expect.poll(() => readShownOrder(section, names)).toEqual([alpha, beta, gamma])
  expect(await readFocusOnceSettled(page, section), 'settled').toBe(`Actions for ${alpha}`)
})

test('puts focus on the Actions button of the rule that takes the place of one moved past the shown rules', AT_EVERY_SIZE, async ({ page, request }) => {
  const { user, names, section } = await openPagedRules(page, request)

  // The read of the next page is held, so the tenth rule stays the last one shown while more wait on the server
  let releasePage: () => void = () => undefined
  const pageHeld = new Promise<void>((resolve) => {
    releasePage = resolve
  })
  let nextPageAsked = false
  await page.route(`**/import-rules?limit=${RULE_PAGE_SIZE}&offset=${RULE_PAGE_SIZE}`, async (route) => {
    nextPageAsked = true
    await pageHeld
    await route.continue().catch(() => undefined)
  })
  const tenthRow = section.getByRole('listitem').filter({ hasText: names[9] })
  await settleRow(tenthRow)
  await expect.poll(() => nextPageAsked).toBe(true)
  await holdStill(tenthRow)

  await chooseWithKeyboard(page, section, names[9], 'Move down', true)
  expect(await readFocus(page), 'at once').toBe(`Actions for ${names[9]}`)
  const afterMove = [...names.slice(0, 9), names[10], names[9], ...names.slice(11)]
  await expect.poll(() => readOrder(request, user)).toEqual(afterMove)
  releasePage()

  // The server's answer puts the rule that was eleventh in the tenth place, and the moved rule leaves the shown rows
  await expect
    .poll(
      async () => {
        const shown = await readShownOrder(section, names)
        return shown.length === RULE_PAGE_SIZE && shown.join() === afterMove.slice(0, RULE_PAGE_SIZE).join()
      },
      { message: 'the eleventh rule takes the tenth place and the moved rule leaves the shown rows' },
    )
    .toBe(true)
  expect(await readFocusOnceSettled(page, section), 'settled').toBe(`Actions for ${names[10]}`)
})

test('returns focus to the rule\'s Actions button when the editor opened from its menu closes', AT_EVERY_SIZE, async ({ page, request }) => {
  const { names, section } = await openThreeRules(page, request)
  const [, beta] = names
  const actions = `Actions for ${beta}`
  const dialog = page.getByRole('dialog', { name: 'Edit rule' })

  for (const close of ['Escape', 'Cancel'] as const) {
    await chooseWithKeyboard(page, section, beta, 'Edit')
    await expect(dialog).toBeVisible()
    if (close === 'Escape') await page.keyboard.press('Escape')
    else await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => readFocus(page), { message: `focus after ${close}` }).toBe(actions)
    expect(await readFocusOnceSettled(page, section), `settled after ${close}`).toBe(actions)
  }

  await chooseWithKeyboard(page, section, beta, 'Edit')
  await dialog.getByRole('textbox', { name: 'Rule name', exact: true }).fill(`${beta} renamed`)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => readFocus(page), { message: 'focus after a save' }).toBe(`Actions for ${beta} renamed`)
  expect(await readFocusOnceSettled(page, section), 'settled after a save').toBe(`Actions for ${beta} renamed`)
})

test('returns focus to the rule\'s Actions button when the delete confirmation is cancelled', AT_EVERY_SIZE, async ({ page, request }) => {
  const { names, section } = await openThreeRules(page, request)
  const [, beta] = names

  await chooseWithKeyboard(page, section, beta, 'Delete')
  await expect(section.getByRole('button', { name: `Cancel deleting ${beta}`, exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  expect(await readFocus(page), 'at once').toBe(`Actions for ${beta}`)
  expect(await readFocusOnceSettled(page, section), 'settled').toBe(`Actions for ${beta}`)
})

test('puts focus on the Actions button of the rule that took the place of a deleted middle rule', AT_EVERY_SIZE, async ({ page, request }) => {
  const { names, section } = await openThreeRules(page, request)
  const [, beta, gamma] = names

  await chooseWithKeyboard(page, section, beta, 'Delete')
  await page.keyboard.press('Tab')
  await expect(section.getByRole('button', { name: `Confirm delete ${beta}`, exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(section.getByRole('listitem')).toHaveCount(2)
  expect(await readFocus(page), 'at once').toBe(`Actions for ${gamma}`)
  expect(await readFocusOnceSettled(page, section), 'settled').toBe(`Actions for ${gamma}`)
})

test('puts focus on the Actions button of the rule before a deleted last rule', AT_EVERY_SIZE, async ({ page, request }) => {
  const { names, section } = await openThreeRules(page, request)
  const [, beta, gamma] = names

  await chooseWithKeyboard(page, section, gamma, 'Delete')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(section.getByRole('listitem')).toHaveCount(2)
  expect(await readFocus(page), 'at once').toBe(`Actions for ${beta}`)
  expect(await readFocusOnceSettled(page, section), 'settled').toBe(`Actions for ${beta}`)
})

test('puts focus on Create rule when the only rule is deleted', AT_EVERY_SIZE, async ({ page, request }) => {
  const { names, section } = await openRules(page, request, 1)

  await chooseWithKeyboard(page, section, names[0], 'Delete')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(section.getByRole('listitem')).toHaveCount(0)
  expect(await readFocus(page), 'at once').toBe('Create rule')
  expect(await readFocusOnceSettled(page, section), 'settled').toBe('Create rule')
})

test('keeps focus on a control of the same row when the server refuses a delete', AT_EVERY_SIZE, async ({ page, request }) => {
  const { names, section } = await openThreeRules(page, request)
  const [, beta] = names
  await page.route('**/import-rules/*', (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: 'Import rule is busy' }) })
      : route.continue(),
  )
  const row = section.getByRole('listitem').filter({ hasText: beta })

  await chooseWithKeyboard(page, section, beta, 'Delete')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(section.getByRole('alert').filter({ hasText: 'Import rule is busy' })).toBeVisible()
  await expect(row.getByRole('button', { name: `Confirm delete ${beta}`, exact: true })).toBeEnabled()
  expect(await readFocus(page), 'once refused').toBe(`Confirm delete ${beta}`)
  expect(await readFocusOnceSettled(page, section), 'settled').toBe(`Confirm delete ${beta}`)
})

test('returns focus to the Actions button after a mouse press on a menu item, with no focus ring a mouse press never had', async ({ page, request }) => {
  const { names, section } = await openThreeRules(page, request)
  const [alpha, beta] = names
  const trigger = section.getByRole('button', { name: `Actions for ${beta}`, exact: true })
  const ring = () => trigger.evaluate((element) => element.matches(':focus-visible'))

  await settleRow(section.getByRole('listitem').filter({ hasText: beta }))
  await (await openRowMenu(page, section, beta)).getByRole('menuitem', { name: 'Move down', exact: true }).click()
  await expect(trigger).toBeFocused()
  expect(await ring(), 'a mouse press shows no ring').toBe(false)
  await expect.poll(() => readShownOrder(section, names)).toEqual([alpha, names[2], beta])

  // The same item chosen with the keyboard does show the ring
  await chooseWithKeyboard(page, section, beta, 'Move up')
  await expect(trigger).toBeFocused()
  expect(await ring(), 'a keyboard choice shows the ring').toBe(true)
})

// Where the control holding focus sits once the list has settled, and what a delete deletes from under it

/** Where focus is and the room around it: the control's edges, the window and the list's own scrolling box when it has one */
async function readFocusPlace(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement
    if (!element || element === document.body) return null
    const box = element.getBoundingClientRect()
    let scroller: Element | null = null
    for (let parent = element.parentElement; parent && !scroller; parent = parent.parentElement) {
      const overflow = getComputedStyle(parent).overflowY
      if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight) scroller = parent
    }
    const room = scroller?.getBoundingClientRect() ?? null
    return {
      name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName,
      top: box.top,
      bottom: box.bottom,
      windowHeight: window.innerHeight,
      boxTop: room?.top ?? null,
      boxBottom: room?.bottom ?? null,
      pageScroll: window.scrollY,
      boxScroll: scroller?.scrollTop ?? null,
    }
  })
}

/** Waits until the focused control has stopped moving, then asserts it is wholly in the window and in the list's box */
async function expectFocusInView(page: Page, name: string) {
  const focused = page.locator(':focus')
  await page.waitForLoadState('networkidle')
  await holdStill(focused)
  const place = await readFocusPlace(page)
  expect(place?.name, 'the control holding focus').toBe(name)
  // A scroll to the nearest edge may leave a fraction of a pixel outside. That is still in view
  expect(place!.top, 'the focused control starts inside the window').toBeGreaterThanOrEqual(-1)
  expect(place!.bottom, 'the focused control ends inside the window').toBeLessThanOrEqual(place!.windowHeight + 1)
  if (place!.boxTop !== null) {
    expect(place!.top, 'the focused control starts inside the list box').toBeGreaterThanOrEqual(place!.boxTop - 1)
    expect(place!.bottom, 'the focused control ends inside the list box').toBeLessThanOrEqual(place!.boxBottom! + 1)
  }
  return place!
}

/** Signs a user in with `count` rules named R01, R02 and so on, shows the first page and opens the section */
async function openRuleCount(page: Page, request: APIRequestContext, count: number) {
  const user = await signUpUser(request)
  const suffix = crypto.randomUUID().slice(0, 8)
  const merchantId = await createMerchant(request, user, `Merchant ${suffix}`)
  // Each rule sets a merchant, a category and a tag, so a row is three lines tall at desktop widths as well and a few
  // rows fill the list's box
  const categoryId = await createNamed(request, user, '/categories', { name: `Category ${suffix}`, kind: 'expense' })
  const tagId = await createNamed(request, user, '/tags', { name: `Tag ${suffix}` })
  const names = Array.from({ length: count }, (_, index) => `R${String(index + 1).padStart(2, '0')} ${suffix}`)
  for (const name of names) {
    await createFullRule(request, user, { name, conditions: [descriptionContains(name)], merchantId, categoryId, tagIds: [tagId] })
  }
  await logInViaApi(page, user)
  await openPage(page, '/settings#import-rules')
  const section = page.locator('#import-rules')
  await expect(section.getByRole('status', { name: 'Loading import rules' })).toHaveCount(0)
  await expect(section.getByRole('listitem')).toHaveCount(Math.min(count, RULE_PAGE_SIZE))
  await bringToRest(page, section)
  return { user, names, section }
}

/** Chooses Delete with the keyboard and confirms it with Tab and Enter */
async function deleteWithKeyboard(page: Page, section: Locator, name: string) {
  await chooseWithKeyboard(page, section, name, 'Delete')
  await page.keyboard.press('Tab')
  await expect(section.getByRole('button', { name: `Confirm delete ${name}`, exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
}

test('keeps the focused button in view when a delete takes the list from eleven rules to ten', AT_EVERY_SIZE, async ({ page, request }) => {
  // The desktop and tablet windows are tall enough to hold the page without scrolling it, so each takes the height of a laptop
  if (test.info().project.name === 'desktop') await page.setViewportSize({ width: 1024, height: 768 })
  if (test.info().project.name === 'tablet') await page.setViewportSize({ width: 768, height: 768 })
  const { names, section } = await openRuleCount(page, request, 11)

  // The ninth rule sits in the middle of the window. With ten rules left the list has no scrolling box of its own, so
  // the rows move after focus has been set
  await deleteWithKeyboard(page, section, names[8])
  await expect(section.getByRole('listitem').filter({ hasText: names[8] })).toHaveCount(0)
  const place = await expectFocusInView(page, `Actions for ${names[9]}`)

  // The delete pushed the button past the window's bottom edge. The page moved only as far as the button needed, so it
  // ends against that edge and not further up
  expect(place.windowHeight - place.bottom, 'the button sits at the window edge it was pushed past').toBeLessThanOrEqual(4)
})

test('keeps the focused button in view, inside the list box, when a rule scrolled into the middle of a longer list is deleted', AT_EVERY_SIZE, async ({ page, request }) => {
  const { names, section } = await openRuleCount(page, request, 14)
  await showRules(section, 14)

  const row = section.getByRole('listitem').filter({ hasText: names[6] })
  await settleRow(row)
  const before = await readFocusPlace(page)
  await deleteWithKeyboard(page, section, names[6])
  await expect(section.getByRole('listitem').filter({ hasText: names[6] })).toHaveCount(0)
  const place = await expectFocusInView(page, `Actions for ${names[7]}`)

  // A control already in view makes nothing scroll
  expect(place.pageScroll, 'the page stays where it was').toBe(before?.pageScroll ?? place.pageScroll)
  expect(place.boxScroll, 'the list box stays where it was').not.toBeNull()
})

test('keeps the focused button off the rule that is being deleted', AT_EVERY_SIZE, async ({ page, request }) => {
  const { user, names, section } = await openThreeRules(page, request)
  const [, beta, gamma] = names
  const betaId = (await readRules(request, user)).find((rule) => rule.name === beta)!.id

  await chooseWithKeyboard(page, section, beta, 'Delete')
  await page.keyboard.press('Tab')
  await expect(section.getByRole('button', { name: `Confirm delete ${beta}`, exact: true })).toBeFocused()
  await page.evaluate(() => {
    const seen: Array<string | null> = []
    ;(window as unknown as { __focusedRows: Array<string | null> }).__focusedRows = seen
    document.addEventListener('focusin', (event) => {
      const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-rule-id]') : null
      seen.push(row?.dataset.ruleId ?? null)
    }, true)
  })
  await page.keyboard.press('Enter')
  await expect(section.getByRole('listitem')).toHaveCount(2)
  expect(await readFocusOnceSettled(page, section), 'settled').toBe(`Actions for ${gamma}`)
  const seen = await page.evaluate(() => (window as unknown as { __focusedRows: Array<string | null> }).__focusedRows)
  expect(seen, 'focus reached a control').not.toHaveLength(0)
  expect(seen, 'no control of the deleted rule took focus').not.toContain(betaId)
})

test('shows no rule twice and none missing while a next page is read during a move', AT_EVERY_SIZE, async ({ page, request }) => {
  const { user, names, section } = await openPagedRules(page, request)

  // Every read of the next page waits here, so the page can be asked for again while a move runs
  let releasePage: () => void = () => undefined
  const pageHeld = new Promise<void>((resolve) => {
    releasePage = resolve
  })
  let nextPageReads = 0
  await page.route(`**/import-rules?limit=${RULE_PAGE_SIZE}&offset=${RULE_PAGE_SIZE}`, async (route) => {
    nextPageReads += 1
    await pageHeld
    await route.continue().catch(() => undefined)
  })

  const list = section.getByRole('list', { name: 'Import rules' })
  // Waits two frames after the scroll, so the list has taken the scroll in before the test goes on
  const scrollListToEnd = () => list.evaluate(async (element) => {
    const scroller = element.closest<HTMLElement>('.overflow-y-auto')!
    scroller.scrollTop = scroller.scrollHeight
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  const scrollListUp = () => list.evaluate((element) => {
    element.closest<HTMLElement>('.overflow-y-auto')!.scrollTop -= 80
  })

  const tenth = names[9]
  await settleRow(section.getByRole('listitem').filter({ hasText: tenth }))
  await scrollListToEnd()
  await expect.poll(() => nextPageReads).toBe(1)

  // The move cancels the read under way and, once the server has answered, reads the loaded pages again from the
  // first. That read is held, and the person scrolls the list to its end a second time while it is under way
  let firstPageReadAsked = false
  let releaseFirstPage: () => void = () => undefined
  const firstPageHeld = new Promise<void>((resolve) => {
    releaseFirstPage = resolve
  })
  await page.route(`**/import-rules?limit=${RULE_PAGE_SIZE}&offset=0`, async (route) => {
    firstPageReadAsked = true
    await firstPageHeld
    await route.continue().catch(() => undefined)
  })
  await chooseWithKeyboard(page, section, tenth, 'Move down', true)
  const afterMove = [...names.slice(0, 9), names[10], names[9], ...names.slice(11)]
  await expect.poll(() => readOrder(request, user)).toEqual(afterMove)
  await expect.poll(() => firstPageReadAsked).toBe(true)
  await scrollListUp()
  await scrollListToEnd()
  releaseFirstPage()
  releasePage()

  // Sampled until the rows settle: a rule never shows twice, and the rows are always the first of the server's order
  const seen: string[][] = []
  const short = (shown: string[]) => shown.map((name) => name.slice(0, 3)).join(' ')
  try {
    await expect
      .poll(
        async () => {
          const shown = await readShownOrder(section, names)
          seen.push(shown)
          return shown.length >= RULE_PAGE_SIZE && shown.join() === afterMove.slice(0, shown.length).join()
        },
        { intervals: [50], timeout: 15_000 },
      )
      .toBe(true)
  } catch (error) {
    const distinct = seen.filter((shown, index) => index === 0 || short(shown) !== short(seen[index - 1]))
    throw new Error(`rows never settled. Reads in turn: ${distinct.map(short).join(' | ')}`, { cause: error })
  }
  const isPrefix = (shown: string[], order: string[]) => shown.join() === order.slice(0, shown.length).join()
  const faulty = seen.filter((shown) => new Set(shown).size !== shown.length || !(isPrefix(shown, names) || isPrefix(shown, afterMove)))
  expect(faulty.length, `${faulty.length} of ${seen.length} reads showed a rule twice or a rule missing: ${JSON.stringify(faulty.slice(0, 2))}`).toBe(0)

  // The scroll that came while the pages were read again asked for nothing, and the list is still at its end with no
  // further scroll to come. The next page loads on its own once that read has ended
  await expect.poll(() => section.getByRole('listitem').count(), { message: 'the next page loads with no further input' }).toBe(PAGED_RULE_COUNT)
  expect(await readShownOrder(section, names)).toEqual(afterMove)
})

test('leaves the page where the person scrolled it when the section changes size after a cancelled delete', async ({ page, request }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  const { names, section } = await openThreeRules(page, request)
  const [, beta] = names
  const actions = section.getByRole('button', { name: `Actions for ${beta}`, exact: true })

  // The cancelled delete holds focus on the Actions button
  await chooseWithKeyboard(page, section, beta, 'Delete')
  await page.keyboard.press('Enter')
  await expect(actions).toBeFocused()

  // The person scrolls the page with the wheel until the focused button is out of the window
  await page.mouse.move(600, 400)
  await page.mouse.wheel(0, -3000)
  await expect.poll(async () => (await actions.boundingBox())!.y).toBeGreaterThan(768)
  await holdStill(actions)
  const left = await page.evaluate(() => window.scrollY)

  // The window gets narrower, so the section changes size. The hold has ended with the wheel, so nothing scrolls back
  const widthBefore = (await section.boundingBox())!.width
  await page.setViewportSize({ width: 960, height: 768 })
  await expect.poll(async () => (await section.boundingBox())!.width).not.toBe(widthBefore)
  await holdStill(actions)
  // Narrowing the window reflows the sections above and moves the page by a few lines of text. A hold that was still
  // on would scroll the button into view. That is several hundred pixels from where the person left the page
  const moved = Math.abs((await page.evaluate(() => window.scrollY)) - left)
  expect(moved, 'the page stays where the person left it, give or take the reflow above').toBeLessThan(100)
  expect((await actions.boundingBox())!.y, 'the button stays out of the window').toBeGreaterThan(768)
})

/** The conditions all of the person's rules may hold, and how many they hold now, as the server says */
async function readBudget(request: APIRequestContext, user: TestUser): Promise<{ limit: number; used: number }> {
  const response = await request.get(`${API_BASE_URL}/import-rules/budget`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  return (await response.json()) as { limit: number; used: number }
}

/**
 * Presses a control at its centre with the pointer, as a person does. `click` waits for the control to be enabled,
 * which one held off with `aria-disabled` never is, so a press on such a control is made here
 */
async function pressAt(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded()
  const box = await control.boundingBox()
  expect(box, 'the control to press is on the page').not.toBeNull()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
}

// Rules are made this many conditions at a time. It is a size of the seeding only, since a rule may hold any
const SEEDED_RULE_SIZE = 25

/** Makes rules named "Budget 1", "Budget 2" and so on that hold `count` conditions together, and returns their names */
async function createRulesHolding(
  request: APIRequestContext,
  user: TestUser,
  merchantId: string,
  count: number,
): Promise<string[]> {
  const names: string[] = []
  for (let left = count; left > 0; left -= SEEDED_RULE_SIZE) {
    const name = `Budget ${names.length + 1}`
    const conditions = Array.from({ length: Math.min(left, SEEDED_RULE_SIZE) }, (_, index) => ({
      kind: 'condition',
      attribute: 'description',
      operator: 'contains',
      value: `${name} text ${index + 1}`,
    }))
    const response = await request.post(`${API_BASE_URL}/import-rules`, {
      headers: asUser(user),
      data: { name, match: 'all', conditions, merchant_id: merchantId, tag_ids: [] },
    })
    expect(response.status()).toBe(201)
    names.push(name)
  }
  return names
}

test('holds Create rule off with its reason once the rules use up the budget, and frees it when a rule is deleted', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const merchantId = await createMerchant(request, user, 'Market')
  const { limit } = await readBudget(request, user)
  const [first] = await createRulesHolding(request, user, merchantId, limit)
  expect(await readBudget(request, user)).toEqual({ limit, used: limit })

  const section = await openSection(page, user)
  const create = section.getByRole('button', { name: 'Create rule', exact: true })
  const reason = `Your import rules already hold ${limit} conditions, the most allowed`
  await expect(create).toHaveAttribute('aria-disabled', 'true')
  await expect(create).toHaveAccessibleDescription(reason)

  // Neither a press nor the keyboard opens the editor. The press shows the reason, as a tap does
  await create.focus()
  await page.keyboard.press('Enter')
  await pressAt(page, create)
  await expect(page.getByTestId('disabled-reason-tooltip').filter({ hasText: reason })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The delete frees the conditions of its rule, and the button is available at once without a reload
  await (await openRowMenu(page, section, first)).getByRole('menuitem', { name: 'Delete' }).click()
  await section.getByRole('button', { name: `Confirm delete ${first}`, exact: true }).click()
  await expect(section.getByRole('listitem').filter({ hasText: first })).toHaveCount(0)
  await expect(create).not.toHaveAttribute('aria-disabled', 'true')
  await expect(create).toHaveAccessibleDescription('')
  await create.click()
  await expect(page.getByRole('dialog', { name: 'Create rule' })).toBeVisible()
})

test('turns the add buttons of the editor off with their reason at the budget, and saves a rule that fills it or is edited there', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const merchantName = 'Market'
  const merchantId = await createMerchant(request, user, merchantName)
  const { limit } = await readBudget(request, user)
  // Three conditions are left for the new rule, so it fills the budget exactly
  await createRulesHolding(request, user, merchantId, limit - 3)
  expect(await readBudget(request, user)).toEqual({ limit, used: limit - 3 })

  const section = await openSection(page, user)
  const create = section.getByRole('button', { name: 'Create rule', exact: true })
  // With conditions left the button is plain and no figure is shown anywhere
  await expect(create).not.toHaveAttribute('aria-disabled', 'true')
  await create.click()
  const dialog = page.getByRole('dialog', { name: 'Create rule' })
  // The top buttons come after the conditions, so once a group holds its own "Add condition" that one is first
  const addCondition = dialog.getByRole('button', { name: 'Add condition', exact: true })
  const addGroup = dialog.getByRole('button', { name: 'Add group', exact: true })
  const reason = `Your import rules can hold ${limit} conditions in all`
  await expect(addCondition).not.toHaveAttribute('aria-disabled', 'true')
  await expect(dialog.getByText(/conditions in all/)).toHaveCount(0)

  await test.step('goes off at the condition that reaches the budget, for all three add buttons', async () => {
    await addGroup.click()
    await expect(dialog.getByRole('textbox', { name: 'Group 1 condition 1 value', exact: true })).toBeVisible()
    // Two conditions with three left: one more still fits
    await expect(addGroup).not.toHaveAttribute('aria-disabled', 'true')
    await expect(addCondition.last()).not.toHaveAttribute('aria-disabled', 'true')
    await addCondition.first().click()
    await expect(dialog.getByRole('textbox', { name: 'Group 1 condition 2 value', exact: true })).toBeVisible()

    for (const button of [addCondition.first(), addCondition.last(), addGroup]) {
      await expect(button).toHaveAttribute('aria-disabled', 'true')
      await expect(button).toHaveAccessibleDescription(reason)
    }
    await pressAt(page, addCondition.last())
    await expect(page.getByTestId('disabled-reason-tooltip').filter({ hasText: reason })).toBeVisible()
    await pressAt(page, addGroup)
    await expect(dialog.getByRole('textbox', { name: /^(Condition|Group) \d.* value$/ })).toHaveCount(3)
  })

  await test.step('comes back when a condition is removed, and goes again when it is added back', async () => {
    await dialog.getByRole('button', { name: 'Remove condition 1', exact: true }).click()
    await expect(addCondition.last()).not.toHaveAttribute('aria-disabled', 'true')
    await expect(addGroup).not.toHaveAttribute('aria-disabled', 'true')
    await addCondition.last().click()
    await expect(addCondition.last()).toHaveAttribute('aria-disabled', 'true')
  })

  await test.step('saves a rule that fills the budget exactly, and holds Create rule off at once', async () => {
    await dialog.getByRole('textbox', { name: 'Rule name', exact: true }).fill('Fills the budget')
    await dialog.getByRole('textbox', { name: 'Condition 1 value', exact: true }).fill('ONE')
    await dialog.getByRole('textbox', { name: 'Group 1 condition 1 value', exact: true }).fill('TWO')
    await dialog.getByRole('textbox', { name: 'Group 1 condition 2 value', exact: true }).fill('THREE')
    await chooseFromDropdown(dialog, 'Set merchant', merchantName)
    await dialog.getByRole('button', { name: 'Create rule', exact: true }).click()
    await expect(dialog).toHaveCount(0)

    expect(await readBudget(request, user)).toEqual({ limit, used: limit })
    await expect(create).toHaveAttribute('aria-disabled', 'true')
    await expect(create).toHaveAccessibleDescription(`Your import rules already hold ${limit} conditions, the most allowed`)
  })

  await test.step('counts the saved conditions of a rule once while it is edited at the budget, and saves it', async () => {
    await openRuleEditor(section, 'Fills the budget')
    const editor = page.getByRole('dialog', { name: 'Edit rule' })
    const editorAdd = editor.getByRole('button', { name: 'Add condition', exact: true })
    for (const button of [editorAdd.first(), editorAdd.last(), editor.getByRole('button', { name: 'Add group', exact: true })]) {
      await expect(button).toHaveAttribute('aria-disabled', 'true')
    }

    // Counted twice, the other rules' conditions and the three saved ones would still fill the budget with one removed
    await editor.getByRole('button', { name: 'Remove group 1 condition 2', exact: true }).click()
    await expect(editorAdd.last()).not.toHaveAttribute('aria-disabled', 'true')
    await editorAdd.last().click()
    await expect(editorAdd.last()).toHaveAttribute('aria-disabled', 'true')
    await editor.getByRole('textbox', { name: 'Condition 2 value', exact: true }).fill('FOUR')
    await editor.getByRole('textbox', { name: 'Rule name', exact: true }).fill('Still fills the budget')
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(editor).toHaveCount(0)

    await expect(section.getByRole('listitem').filter({ hasText: 'Still fills the budget' })).toBeVisible()
    expect(await readBudget(request, user)).toEqual({ limit, used: limit })
  })
})

test('shows the refusal of a rule past the budget on the conditions when the rest was used after the editor opened', async ({ page, request }) => {
  const user = await signUpUser(request)
  const merchantName = 'Market'
  const merchantId = await createMerchant(request, user, merchantName)
  const { limit } = await readBudget(request, user)
  const names = await createRulesHolding(request, user, merchantId, limit - 1)

  const section = await openSection(page, user)
  await section.getByRole('button', { name: 'Create rule', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create rule' })
  await dialog.getByRole('textbox', { name: 'Rule name', exact: true }).fill('One too many')
  await dialog.getByRole('textbox', { name: 'Condition 1 value', exact: true }).fill('LATE')
  await chooseFromDropdown(dialog, 'Set merchant', merchantName)

  // Another tab uses the last condition, and the open editor has no way to know
  await createRule(request, user, 'Taken first', merchantId)
  await dialog.getByRole('button', { name: 'Create rule', exact: true }).click()

  const refusal = `Your import rules can hold ${limit} conditions in all. Please remove a condition from this rule or another rule first`
  await expect(dialog.getByRole('alert').filter({ hasText: refusal })).toBeVisible()
  await expect(dialog).toBeVisible()
  expect(await readOrder(request, user)).toEqual([...names, 'Taken first'])
  expect(await readBudget(request, user)).toEqual({ limit, used: limit })
})

/** Makes a rule with the conditions and results given, and returns nothing: the tests read it back through the page */
async function createFullRule(
  request: APIRequestContext,
  user: TestUser,
  rule: { name: string; conditions: unknown[]; merchantId?: string; categoryId?: string; tagIds?: string[] },
): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/import-rules`, {
    headers: asUser(user),
    data: {
      name: rule.name,
      match: 'all',
      conditions: rule.conditions,
      merchant_id: rule.merchantId ?? null,
      category_id: rule.categoryId ?? null,
      tag_ids: rule.tagIds ?? [],
    },
  })
  expect(response.status()).toBe(201)
}

const descriptionContains = (value: string) => ({ kind: 'condition', attribute: 'description', operator: 'contains', value })

async function createNamed(request: APIRequestContext, user: TestUser, path: string, data: object): Promise<string> {
  const response = await request.post(`${API_BASE_URL}${path}`, { headers: asUser(user), data })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { id: string }).id
}

/** What a rule's row shows a person, read from the page: the three parts of the one button and the lines of what it sets */
async function readRowParts(row: Locator) {
  return row.evaluate((item) => {
    // The button that opens the editor is the one holding the sliding sentence's box
    const button = item.querySelector<HTMLElement>('button:has([data-overflow])')!
    const [name, , when, sets] = Array.from(button.children) as HTMLElement[]
    // What the rule sets follows the Sets label, the one part of its line a screen reader skips
    const setValues = sets.querySelector<HTMLElement>(':scope > :not([aria-hidden="true"])')!
    const capitalized = (text: string) => text.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
    // The words a screen reader hears in front of each value are drawn in a box a pixel wide, so they are left out
    const drawnText = (element: Element): string =>
      Array.from(element.childNodes)
        .map((node) => (node instanceof Element ? (node.getBoundingClientRect().width > 1 ? drawnText(node) : '') : (node.textContent ?? '')))
        .join('')
    // The sliding sentence's copy at rest is its one child a screen reader hears
    const restingCopy = (part: Element) => (part.hasAttribute('data-overflow') ? part.querySelector(':scope > :not([aria-hidden="true"])')! : part)
    const groups = Array.from(setValues.children)
      .filter((group) => !group.getAttribute('aria-hidden'))
      .map((group) => {
        const [kind, values] = Array.from(group.children) as HTMLElement[]
        const kindText = kind.textContent ?? ''
        return {
          text: `${getComputedStyle(kind).textTransform === 'capitalize' ? capitalized(kindText) : kindText} ${drawnText(values)}`,
          display: getComputedStyle(group).display,
          top: group.getBoundingClientRect().top,
        }
      })
    const commas = Array.from(setValues.querySelectorAll(':scope > [aria-hidden="true"]')).map(
      (comma) => getComputedStyle(comma).display,
    )
    // Each width draws its own copy of the sentence and leaves the other out
    const shownSentence = Array.from(when.children).find(
      (part) => !part.getAttribute('aria-hidden') && getComputedStyle(part).display !== 'none',
    )!
    const middleOf = (element: Element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const box = range.getClientRects()[0]
      return box.top + box.height / 2
    }
    return {
      name: name.textContent,
      sentence: restingCopy(when.querySelector('[data-overflow]')!).textContent,
      groups,
      commas,
      columns: {
        name: name.getBoundingClientRect().left,
        when: when.getBoundingClientRect().left,
        sets: sets.getBoundingClientRect().left,
        actions: item.querySelector('[aria-haspopup="menu"]')!.parentElement!.getBoundingClientRect().right,
      },
      sentenceLeft: shownSentence.getBoundingClientRect().left,
      setsLeft: setValues.getBoundingClientRect().left,
      firstLines: {
        name: middleOf(name),
        sentence: middleOf(restingCopy(shownSentence)),
        sets: middleOf(setValues.querySelector(':scope > span > span')!),
      },
    }
  })
}

test('lays the rules out as a table with headings from 750px, and as When and Sets lines below, with no pills', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const merchantId = await createMerchant(request, user, 'Corner Market')
  const categoryId = await createNamed(request, user, '/categories', { name: 'Pet supplies', kind: 'expense' })
  const [holiday, shared, gifts, reimbursable, travel, subscriptions] = await Promise.all(
    ['Holiday', 'Shared', 'Gifts', 'Reimbursable', 'Travel', 'Subscriptions'].map((name) => createNamed(request, user, '/tags', { name })),
  )
  await createFullRule(request, user, {
    name: 'Everything',
    conditions: [descriptionContains('FRESHCO')],
    merchantId,
    categoryId,
    tagIds: [holiday, shared],
  })
  await createFullRule(request, user, { name: 'Many tags', conditions: [descriptionContains('AIR')], tagIds: [gifts, holiday, reimbursable, shared, travel] })
  await createFullRule(request, user, { name: 'Streaming', conditions: [descriptionContains('STREAM')], tagIds: [subscriptions] })
  await createFullRule(request, user, { name: 'Market only', conditions: [descriptionContains('MARKET')], merchantId })

  const section = await openSection(page, user)
  await expect(section.getByRole('listitem')).toHaveCount(4)
  const wide = (page.viewportSize()?.width ?? 0) >= 750
  // The headings are one row a screen reader skips, reading Rule, When, Sets and Actions
  const headings = section.locator('[aria-hidden="true"]').filter({ hasText: /^RuleWhenSetsActions$/ })
  await expect(headings).toHaveCount(1)

  // The headings are for the eye: drawn at 750px and wider, and not read out, since each row says its own parts
  if (wide) {
    await expect(headings).toBeVisible()
  } else {
    await expect(headings).toBeHidden()
  }
  await expect(section.getByRole('columnheader')).toHaveCount(0)

  const [everything, many, streaming, marketOnly] = await Promise.all(
    ['Everything', 'Many tags', 'Streaming', 'Market only'].map((name) => readRowParts(section.getByRole('listitem').filter({ hasText: name }))),
  )
  expect(everything.name).toBe('Everything')
  expect(everything.sentence).toBe('Description contains "FRESHCO"')

  if (wide) {
    // One line for each kind, the kind first and the value after it. One tag is "Tag", and past four tags the line ends "+1"
    expect(everything.groups.map((group) => group.text)).toEqual(['Merchant Corner Market', 'Category Pet supplies', 'Tags Holiday, Shared'])
    expect(everything.groups.map((group) => group.display)).toEqual(['block', 'block', 'block'])
    expect(everything.groups[1].top).toBeGreaterThan(everything.groups[0].top)
    expect(everything.groups[2].top).toBeGreaterThan(everything.groups[1].top)
    expect(everything.commas).toEqual(['none', 'none'])
    expect(many.groups.map((group) => group.text)).toEqual(['Tags Gifts, Holiday, Reimbursable, Shared +1'])
    expect(streaming.groups.map((group) => group.text)).toEqual(['Tag Subscriptions'])
    expect(marketOnly.groups.map((group) => group.text)).toEqual(['Merchant Corner Market'])

    // Each heading sits over its column, and Actions over the menu button's end
    const [headingColumns, headingActions] = await headings.evaluate((line) => {
      const [, columns, actions] = Array.from(line.children) as HTMLElement[]
      return [
        Array.from(columns.children).map((cell) => cell.getBoundingClientRect().left),
        actions.getBoundingClientRect().right,
      ] as const
    })
    expect(headingColumns.map(Math.round), 'Rule, When and Sets start where their columns do').toEqual(
      [everything.columns.name, everything.columns.when, everything.columns.sets].map(Math.round),
    )
    expect(Math.round(headingActions)).toBe(Math.round(everything.columns.actions))

    // The three columns start on the same line of text
    for (const row of [everything, many, streaming, marketOnly]) {
      expect(Math.abs(row.firstLines.sentence - row.firstLines.name), 'the sentence starts on the name line').toBeLessThan(2)
      expect(Math.abs(row.firstLines.sets - row.firstLines.name), 'what it sets starts on the name line').toBeLessThan(2)
    }
  } else {
    // The kinds run on in one line that may wrap, each followed by a comma but the last, below a When line of its own
    expect(everything.groups.map((group) => group.text)).toEqual(['merchant Corner Market', 'category Pet supplies', 'tags Holiday, Shared'])
    expect(everything.groups.map((group) => group.display)).toEqual(['inline', 'inline', 'inline'])
    expect(everything.commas).toEqual(['inline', 'inline'])
    expect(many.groups.map((group) => group.text)).toEqual(['tags Gifts, Holiday, Reimbursable, Shared +1'])
    expect(streaming.groups.map((group) => group.text)).toEqual(['tag Subscriptions'])
    // The labels share one narrow column, so the sentence and what it sets start at the same place
    expect(Math.round(everything.sentenceLeft)).toBe(Math.round(everything.setsLeft))
    const labels = await section.getByRole('listitem').first().evaluate((row) =>
      Array.from(row.querySelectorAll('span[aria-hidden="true"]'))
        .filter((label) => label.textContent === 'When' || label.textContent === 'Sets')
        .map((label) => [label.textContent, getComputedStyle(label).display !== 'none']),
    )
    expect(labels).toEqual([
      ['When', true],
      ['Sets', true],
    ])
  }

  // A screen reader hears what each row says of its own, never a heading or a label read twice
  const opener = section.getByRole('button', { name: /^Everything\b/ })
  await expect(opener).toHaveAccessibleName(/Description contains "FRESHCO".*Sets merchant Corner Market.*Sets category Pet supplies.*Adds tag Holiday.*Adds tag Shared/)
  await expect(opener, 'the When and Sets labels are for the eye alone').not.toHaveAccessibleName(/\bWhen\b/)

  // No pill is drawn: nothing in a row has a border and a fill of its own besides the row's own buttons
  const pills = await section.getByRole('listitem').evaluateAll((rows) =>
    rows.flatMap((row) =>
      Array.from(row.querySelectorAll('span')).filter((span) => {
        const style = getComputedStyle(span)
        return parseFloat(style.borderTopWidth) > 0 && parseFloat(style.borderRadius) > 0
      }),
    ).length,
  )
  expect(pills).toBe(0)
})

/** The rules of the search tests: names, conditions and what each sets differ, so each way of matching finds a rule of its own */
async function openRulesToSearch(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request)
  const merchantId = await createMerchant(request, user, 'Corner Market')
  const tagId = await createNamed(request, user, '/tags', { name: 'Holiday' })
  const categoryId = await createNamed(request, user, '/categories', { name: 'Pet supplies', kind: 'expense' })
  await createFullRule(request, user, { name: 'Fuel stop', conditions: [descriptionContains('SHELL')], categoryId })
  await createFullRule(request, user, {
    name: 'Reimbursements',
    conditions: [{ kind: 'group', match: 'any', conditions: [{ kind: 'condition', attribute: 'note', operator: 'contains', value: 'Expensed' }] }],
    tagIds: [tagId],
  })
  await createFullRule(request, user, { name: 'Market run', conditions: [descriptionContains('FRESHCO')], merchantId })
  await createFullRule(request, user, { name: 'Streaming', conditions: [descriptionContains('STREAM')], tagIds: [tagId] })
  const section = await openSection(page, user)
  await expect(section.getByRole('listitem')).toHaveCount(4)
  await bringToRest(page, section)
  return { user, section, search: section.getByPlaceholder('Search import rules…') }
}

const shownNames = (section: Locator) =>
  // The name is the first part of the button holding the sliding sentence's box
  section.getByRole('listitem').evaluateAll((rows) => rows.map((row) => row.querySelector('button:has([data-overflow]) > span')?.textContent))

test('narrows the rules as text is typed, by name, condition text, merchant, category and tag, and lists them all again when it is cleared', AT_EVERY_SIZE, async ({ page, request }) => {
  const { section, search } = await openRulesToSearch(page, request)

  // A rule's name, ignoring case
  await search.fill('FUEL')
  await expect.poll(() => shownNames(section)).toEqual(['Fuel stop'])
  // The text a Description condition looks for, and the text of a Note condition inside a group
  await search.fill('freshco')
  await expect.poll(() => shownNames(section)).toEqual(['Market run'])
  await search.fill('expensed')
  await expect.poll(() => shownNames(section)).toEqual(['Reimbursements'])
  // The merchant, category and tags a rule sets, the rules keeping the order they are checked in
  await search.fill('corner')
  await expect.poll(() => shownNames(section)).toEqual(['Market run'])
  await search.fill('pet supplies')
  await expect.poll(() => shownNames(section)).toEqual(['Fuel stop'])
  await search.fill('holiday')
  await expect.poll(() => shownNames(section)).toEqual(['Reimbursements', 'Streaming'])
  // The words a row's sentence is built from are not searched
  await search.fill('contains')
  await expect(section.getByText('No import rules match your search.')).toBeVisible()
  await expect(section.getByRole('listitem')).toHaveCount(0)

  await search.fill('')
  await expect.poll(() => shownNames(section)).toEqual(['Fuel stop', 'Reimbursements', 'Market run', 'Streaming'])
  await expect(section.getByText('No import rules match your search.')).toHaveCount(0)
})

test('searches on Enter without waiting for the pause, and says so in the Merchants list voice when nothing matches', AT_EVERY_SIZE, async ({ page, request }) => {
  const { section, search } = await openRulesToSearch(page, request)
  const searched = page.waitForRequest((sent) => sent.url().includes('/import-rules?') && sent.url().includes('q=stream'))

  await search.fill('stream')
  await search.press('Enter')
  await searched
  await expect.poll(() => shownNames(section)).toEqual(['Streaming'])

  await search.fill('zzz')
  await expect(section.getByText('No import rules match your search.')).toBeVisible()
  // The empty message of an empty list is another, and Create rule stays where it is
  await expect(section.getByText('No import rules yet.')).toHaveCount(0)
  await expect(section.getByRole('button', { name: 'Create rule', exact: true })).toBeEnabled()
})

test('holds the grips and both moves off with the reason while a search is on, and frees them when it is cleared', AT_EVERY_SIZE, async ({ page, request }) => {
  const { section, search } = await openRulesToSearch(page, request)
  const reason = 'Please clear the search to move rules'
  await search.fill('s')
  await expect.poll(() => shownNames(section)).toEqual(['Fuel stop', 'Reimbursements', 'Market run', 'Streaming'])

  for (const name of ['Fuel stop', 'Reimbursements', 'Market run', 'Streaming']) {
    const grip = section.getByRole('button', { name: `Move ${name}`, exact: true })
    await expect(grip).toHaveAttribute('aria-disabled', 'true')
    await expect(grip).toHaveAccessibleDescription(reason)
  }

  // The reason shows beside the grip on the pointer and on the keyboard, and the keyboard can not lift the row
  const grip = section.getByRole('button', { name: 'Move Reimbursements', exact: true })
  await grip.hover()
  await expect(page.getByTestId('disabled-reason-tooltip').filter({ hasText: reason })).toBeVisible()
  await page.mouse.move(2, 2)
  await grip.focus()
  await expect(page.getByTestId('disabled-reason-tooltip').filter({ hasText: reason })).toBeVisible()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowDown')
  await expect(grip).not.toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Picked up Reimbursements')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Both moves of a row in the middle are unavailable with the reason, and Edit and Delete are not
  await settleRow(section.getByRole('listitem').filter({ hasText: 'Reimbursements' }))
  const menu = await openRowMenu(page, section, 'Reimbursements')
  for (const item of ['Move up', 'Move down']) {
    const move = menu.getByRole('menuitem', { name: item, exact: true })
    await expect(move).toHaveAttribute('aria-disabled', 'true')
    await move.hover()
    // The tooltip glides from the item before to this one, so for a moment the old and the new both exist
    await expect(page.getByTestId('disabled-reason-tooltip').filter({ hasText: reason }).last()).toBeVisible()
  }
  await expect(menu.getByRole('menuitem', { name: 'Edit', exact: true })).not.toHaveAttribute('aria-disabled', 'true')
  await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).not.toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Escape')

  await search.fill('')
  await expect.poll(() => shownNames(section)).toHaveLength(4)
  await expect(section.getByRole('button', { name: 'Move Reimbursements', exact: true })).not.toHaveAttribute('aria-disabled', 'true')
  const freed = await openRowMenu(page, section, 'Reimbursements')
  await expect(freed.getByRole('menuitem', { name: 'Move up', exact: true })).not.toHaveAttribute('aria-disabled', 'true')
  await expect(freed.getByRole('menuitem', { name: 'Move down', exact: true })).not.toHaveAttribute('aria-disabled', 'true')
})

test('deletes a rule from the results of a search, with the focus where it goes without one, and lists the rest after the search is cleared', AT_EVERY_SIZE, async ({ page, request }) => {
  const { user, section, search } = await openRulesToSearch(page, request)
  await search.fill('holiday')
  await expect.poll(() => shownNames(section)).toEqual(['Reimbursements', 'Streaming'])

  await chooseWithKeyboard(page, section, 'Reimbursements', 'Delete')
  await page.keyboard.press('Tab')
  await expect(section.getByRole('button', { name: 'Confirm delete Reimbursements', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(() => shownNames(section)).toEqual(['Streaming'])
  expect(await readFocus(page), 'at once').toBe('Actions for Streaming')
  expect(await readFocusOnceSettled(page, section), 'settled').toBe('Actions for Streaming')

  // The last rule of the results goes too, and focus goes to Create rule as it does with no search
  await chooseWithKeyboard(page, section, 'Streaming', 'Delete')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(section.getByText('No import rules match your search.')).toBeVisible()
  expect(await readFocusOnceSettled(page, section), 'settled').toBe('Create rule')

  await search.fill('')
  await expect.poll(() => shownNames(section)).toEqual(['Fuel stop', 'Market run'])
  expect(await readOrder(request, user)).toEqual(['Fuel stop', 'Market run'])
  expect((await readRules(request, user)).map((rule) => rule.position)).toEqual([0, 1])
})

test('shows an edit in the results of a search without a reload, and drops a rule that no longer matches', AT_EVERY_SIZE, async ({ page, request }) => {
  const { user, section, search } = await openRulesToSearch(page, request)
  await search.fill('holiday')
  await expect.poll(() => shownNames(section)).toEqual(['Reimbursements', 'Streaming'])

  // A rename that still matches by the tag shows in place
  await openRuleEditor(section, 'Streaming')
  let dialog = page.getByRole('dialog', { name: 'Edit rule' })
  await dialog.getByRole('textbox', { name: 'Rule name', exact: true }).fill('Streaming services')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => shownNames(section)).toEqual(['Reimbursements', 'Streaming services'])

  // A rename that leaves the search nothing to find in the rule takes it out of the results, with no reload
  await search.fill('fuel')
  await expect.poll(() => shownNames(section)).toEqual(['Fuel stop'])
  await openRuleEditor(section, 'Fuel stop')
  dialog = page.getByRole('dialog', { name: 'Edit rule' })
  await dialog.getByRole('textbox', { name: 'Rule name', exact: true }).fill('Gas stop')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(section.getByText('No import rules match your search.')).toBeVisible()
  await expect(section.getByRole('listitem')).toHaveCount(0)
  expect(await readOrder(request, user)).toEqual(['Gas stop', 'Reimbursements', 'Market run', 'Streaming services'])

  await search.fill('')
  await expect.poll(() => shownNames(section)).toEqual(['Gas stop', 'Reimbursements', 'Market run', 'Streaming services'])
})

test('creates a rule while a search is on, with Create rule as available as it is without one', AT_EVERY_SIZE, async ({ page, request }) => {
  const { user, section, search } = await openRulesToSearch(page, request)
  await search.fill('fuel')
  await expect.poll(() => shownNames(section)).toEqual(['Fuel stop'])
  const create = section.getByRole('button', { name: 'Create rule', exact: true })
  await expect(create).not.toHaveAttribute('aria-disabled', 'true')

  await create.click()
  const dialog = page.getByRole('dialog', { name: 'Create rule' })
  await dialog.getByRole('textbox', { name: 'Rule name', exact: true }).fill('Fuel card')
  await dialog.getByRole('textbox', { name: 'Condition 1 value', exact: true }).fill('ESSO')
  await chooseFromDropdown(dialog, 'Set merchant', 'Corner Market')
  await dialog.getByRole('button', { name: 'Create rule', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  await expect.poll(() => shownNames(section)).toEqual(['Fuel stop', 'Fuel card'])
  expect((await readOrder(request, user)).at(-1)).toBe('Fuel card')
})
