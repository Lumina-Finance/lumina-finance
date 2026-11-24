import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import {
  createAccount,
  createMonthlyBudget,
  createTaxAdvantagedCategory,
  createTransaction,
  daysFromTodayInTestTimezone,
  signUpUser,
} from '../support/api'
import { logInViaApi, openPage, readSettledBox } from '../support/app'
import { claimSetupToken, createSampleBridgeScenario } from '../support/bankSync'
import { NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { openFilters } from '../support/filters'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: each test sets the sizes it checks itself. Focus scrolls a control into view only as
// far as the edge of the dialogue body that scrolls it, so the body keeps the room its padding gives between a
// focused control and the header or footer only when that padding is also its scroll padding

const SIZES = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]

// A control cut by this much at an edge is partly in view. The browser scrolls a partly visible control to the
// nearest edge, where it centres one that is out of view
const CUT_PX = 8

// Subpixel layout leaves the room a pixel short of the padding it should equal
const TOLERANCE_PX = 1

/** Reads how far a control is from the edges of the body that scrolls it, and the padding that body has */
function readRoom(control: Locator) {
  return control.evaluate((element) => {
    let body = element.parentElement
    while (body && !['auto', 'scroll'].includes(getComputedStyle(body).overflowY)) body = body.parentElement
    if (!body) throw new Error('no scrolling body around the control')
    const area = body.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(body)
    return {
      above: box.top - area.top,
      below: area.bottom - box.bottom,
      paddingTop: parseFloat(style.paddingTop),
      paddingBottom: parseFloat(style.paddingBottom),
    }
  })
}

/** Scrolls the body around a control until the control is cut by `CUT_PX` at its top or bottom edge */
function cutAt(control: Locator, edge: 'top' | 'bottom') {
  return control.evaluate(
    (element, { at, cut }) => {
      let body = element.parentElement
      while (body && !['auto', 'scroll'].includes(getComputedStyle(body).overflowY)) body = body.parentElement
      if (!body) throw new Error('no scrolling body around the control')
      const area = body.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      body.scrollTop += at === 'bottom' ? box.bottom - (area.bottom + cut) : box.top - (area.top - cut)
    },
    { at: edge, cut: CUT_PX },
  )
}

/** Whether keyboard focus is on a control inside a dialogue's scrolling body, as opposed to its header or footer */
function focusIsInBody(page: Page) {
  return page.locator(':focus').evaluate((element) => element.closest('[data-dropdown-bounds]') !== null)
}

async function openExpense(page: Page, request: APIRequestContext, size: (typeof SIZES)[number]) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -3000, date: daysFromTodayInTestTimezone(-3) })
  await createTransaction(request, user, { ...row, amount: 1200, date: daysFromTodayInTestTimezone(-1) })

  await page.setViewportSize(size)
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await page.getByTestId(`transaction-row-${expenseId}`).click()
  const dialogue = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
  await expect(dialogue).toBeVisible()
  await readSettledBox(dialogue)
  return { dialogue, user, account }
}

// The Edit transaction body scrolls at both sizes, with the Link an existing refund button last in it. Tab or
// Shift+Tab onto a control that is partly cut at an edge leaves the body's padding between the control and that
// edge. The button keeps its room through opening the Link a refund picker and cancelling it, and cancelling
// returns focus to it
for (const size of SIZES) {
  test(`keeps the body's padding around a control Tab scrolls into view at ${size.width}×${size.height}`, async ({ page, request }) => {
    const { dialogue } = await openExpense(page, request, size)
    const button = dialogue.getByRole('button', { name: 'Link an existing refund', exact: true })
    const amount = dialogue.getByLabel('Amount')

    await test.step('below the control', async () => {
      await button.focus()
      await page.keyboard.press('Shift+Tab')
      await cutAt(button, 'bottom')
      expect((await readRoom(button)).below).toBeCloseTo(-CUT_PX, 0)

      await page.keyboard.press('Tab')
      await expect(button).toBeFocused()
      const room = await readRoom(button)
      expect(room.paddingBottom).toBeGreaterThan(0)
      expect.soft(room.below, 'room under the button').toBeGreaterThanOrEqual(room.paddingBottom - TOLERANCE_PX)
    })

    await test.step('after the picker closes', async () => {
      await page.keyboard.press('Enter')
      const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
      await expect(picker).toBeVisible()
      await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(picker).toBeHidden()
      await expect(button).toBeFocused()
      const room = await readRoom(button)
      expect.soft(room.below, 'room under the button once the picker has closed').toBeGreaterThanOrEqual(room.paddingBottom - TOLERANCE_PX)
    })

    await test.step('above the control', async () => {
      // Only a control near the top of the body can be scrolled up under the header, so the step walks back from
      // Amount out of the body and takes the first stop in it, whichever control that is
      await amount.focus()
      for (let presses = 0; presses < 40 && (await focusIsInBody(page)); presses += 1) await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      await page.locator(':focus').evaluate((element) => element.setAttribute('data-first-stop', ''))
      const first = page.locator('[data-first-stop]')
      await page.keyboard.press('Tab')
      await cutAt(first, 'top')
      expect((await readRoom(first)).above).toBeCloseTo(-CUT_PX, 0)

      await page.keyboard.press('Shift+Tab')
      await expect(first).toBeFocused()
      const room = await readRoom(first)
      expect(room.paddingTop).toBeGreaterThan(0)
      expect.soft(room.above, 'room over the control').toBeGreaterThanOrEqual(room.paddingTop - TOLERANCE_PX)
    })
  })
}

/**
 * Reads the padding and scroll padding of each area that scrolls in the dialogue, leaving out areas inside
 * another that scrolls, such as a list in a filter sheet's body
 */
function readScrollAreas(dialogue: Locator) {
  return dialogue.evaluate((panel) => {
    const scrolls = (element: Element) => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY)
    const length = (value: string) => (value === 'auto' ? 0 : parseFloat(value))
    return [panel, ...panel.querySelectorAll('*')]
      .filter((element) => scrolls(element) && element.scrollHeight > 0)
      .filter((element) => {
        for (let parent = element.parentElement; parent && parent !== panel.parentElement; parent = parent.parentElement) {
          if (scrolls(parent)) return false
        }
        return true
      })
      .map((element) => {
        const style = getComputedStyle(element)
        return {
          paddingTop: parseFloat(style.paddingTop),
          paddingBottom: parseFloat(style.paddingBottom),
          scrollPaddingTop: length(style.scrollPaddingTop),
          scrollPaddingBottom: length(style.scrollPaddingBottom),
          // A footer drawn over the end of the body is cleared by the scroll padding as well
          footerHeight: element.querySelector<HTMLElement>('.app-modal-footer')?.offsetHeight ?? 0,
        }
      })
      .filter((area) => area.paddingTop > 0 || area.paddingBottom > 0)
  })
}

async function expectScrollPaddingToMatchPadding(dialogue: Locator, name: string) {
  await readSettledBox(dialogue)
  const areas = await readScrollAreas(dialogue)
  expect(areas.length, `${name} has a padded area that scrolls`).toBeGreaterThan(0)
  for (const area of areas) {
    expect.soft(area.scrollPaddingTop, `${name} scroll padding at the top`).toBe(area.paddingTop)
    const bottom = area.footerHeight > 0 ? area.footerHeight + area.paddingTop : area.paddingBottom
    expect.soft(Math.abs(area.scrollPaddingBottom - bottom), `${name} scroll padding at the bottom, ${bottom} wanted`).toBeLessThanOrEqual(TOLERANCE_PX)
  }
}

async function closeTopDialogue(page: Page, dialogue: Locator) {
  await page.keyboard.press('Escape')
  await expect(dialogue).toBeHidden()
}

// Every dialogue whose body scrolls takes the same rule, whichever panel draws it, so this reads each body's
// scroll padding beside its padding across the panels the app has
for (const size of SIZES) {
  test(`gives every dialogue body the scroll padding of its padding at ${size.width}×${size.height}`, async ({ page, request }) => {
    // Stands in for a provider-created account, whose reauth lands in Settings with the flag that opens the Set a
    // password dialogue. It is in place before sign-in, since the answer is saved with the rest of the page's data
    await page.route(`${API_BASE_URL}/auth/oidc/identities`, (route) =>
      route.fulfill({ json: { has_password: false, identities: [] } }))
    const { dialogue: transaction, user, account } = await openExpense(page, request, size)
    await createTaxAdvantagedCategory(request, user, 'Retirement Savings')

    await test.step('Edit transaction and the Link a refund picker over it', async () => {
      await expectScrollPaddingToMatchPadding(transaction, 'Edit transaction')
      await transaction.getByRole('button', { name: 'Link an existing refund', exact: true }).focus()
      await page.keyboard.press('Enter')
      const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
      await expect(picker).toBeVisible()
      await expectScrollPaddingToMatchPadding(picker, 'Link a refund')
      await closeTopDialogue(page, picker)
      await closeTopDialogue(page, transaction)
    })

    await test.step('Edit account', async () => {
      await page.getByRole('button', { name: 'Edit account', exact: true }).click()
      const dialogue = page.getByRole('dialog', { name: 'Edit account', exact: true })
      await expect(dialogue).toBeVisible()
      await expectScrollPaddingToMatchPadding(dialogue, 'Edit account')
      await closeTopDialogue(page, dialogue)
    })

    await test.step('a tax-advantaged category', async () => {
      await openPage(page, '/settings#tax-advantaged-categories')
      await page.getByRole('row').filter({ hasText: 'Retirement Savings' }).click()
      const dialogue = page.getByRole('dialog', { name: 'Retirement Savings', exact: true })
      await expect(dialogue).toBeVisible()
      await expectScrollPaddingToMatchPadding(dialogue, 'Retirement Savings')
      await dialogue.getByRole('button', { name: 'Add year', exact: true }).click()
      const year = page.getByRole('dialog', { name: 'New year', exact: true })
      await expect(year).toBeVisible()
      await expectScrollPaddingToMatchPadding(year, 'New year')
    })

    await test.step('Set a password', async () => {
      await openPage(page, '/budgets')
      await page.evaluate(() => {
        window.history.pushState({ usr: { setPassword: true }, key: 'set-password', idx: 1 }, '', '/settings#security')
        window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
      })
      const dialogue = page.getByRole('dialog', { name: 'Set a password' })
      await expect(dialogue).toBeVisible()
      await expectScrollPaddingToMatchPadding(dialogue, 'Set a password')
    })

    if (size.width < 750) {
      await test.step('the phone filter sheet', async () => {
        await openPage(page, `/accounts/${account.id}`)
        const sheet = await openFilters(page, 'Transaction')
        await expectScrollPaddingToMatchPadding(sheet, 'Transaction filters')
      })
    }
  })
}

// A content dialogue keeps its actions in a footer that stays at the bottom of the scrolling body, drawn over
// the content. The browser scrolls a focused control to the body's edge, and that edge lies under the footer.
// The body's bottom scroll padding has to clear the footer's own height, with the room the body gives its content
test('keeps a control Tab scrolls into view clear of the footer that stays at the bottom of its dialogue', async ({ page, request }) => {
  await page.route(`${API_BASE_URL}/auth/oidc/identities`, (route) =>
    route.fulfill({ json: { has_password: false, identities: [] } }))
  const user = await signUpUser(request)
  await page.setViewportSize({ width: 390, height: 240 })
  await logInViaApi(page, user)
  await openPage(page, '/budgets')
  await page.evaluate(() => {
    window.history.pushState({ usr: { setPassword: true }, key: 'set-password', idx: 1 }, '', '/settings#security')
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
  })
  const dialogue = page.getByRole('dialog', { name: 'Set a password' })
  await expect(dialogue).toBeVisible()
  await readSettledBox(dialogue)

  const first = dialogue.getByLabel('New password', { exact: true })
  const second = dialogue.getByLabel('Confirm new password', { exact: true })
  await first.focus()
  await cutAt(second, 'bottom')
  expect((await readRoom(second)).below).toBeCloseTo(-CUT_PX, 0)

  await page.keyboard.press('Tab')
  await expect(second).toBeFocused()
  await readSettledBox(second)
  // The room the body gives the control when it is scrolled to the end is as much as the layout leaves
  // between the last field and the footer. A control reached before the end keeps at least that much
  const gaps = await second.evaluate((element) => {
    const body = element.closest('.app-modal-body')
    const footer = body?.querySelector('.app-modal-footer')
    if (!body || !footer) throw new Error('no footer in the dialogue body')
    const gap = () => footer.getBoundingClientRect().top - element.getBoundingClientRect().bottom
    const reached = gap()
    body.scrollTop = body.scrollHeight
    return { reached, atEnd: gap() }
  })
  expect(gaps.atEnd).toBeGreaterThan(0)
  expect.soft(gaps.reached, 'room between the control and the footer').toBeGreaterThanOrEqual(gaps.atEnd - TOLERANCE_PX)
})

// A checkbox's label wraps below its box. Focus scrolls only the box to the padded edge and leaves the end of a
// wrapped label against the footer, so the whole label has to keep the room the control would
test('keeps the whole wrapped label of a checkbox clear of the footer after Tab scrolls to it', async ({ page, request }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  // Report an authenticator as on and stand in for the regeneration, so the account needs no real factor
  await page.route(`${API_BASE_URL}/auth/2fa/status`, (route) => route.fulfill({ json: { totp_enabled: true } }))
  await page.route(`${API_BASE_URL}/auth/2fa/recovery-codes`, (route) =>
    route.fulfill({ json: { recovery_codes: Array.from({ length: 10 }, (_, i) => `aaaa-bbbb-cccc-dddd-${i}000`) } }))
  await openPage(page, '/settings#security')
  await page.locator('#security').getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('button', { name: 'Regenerate' }).click()
  const stepUp = page.getByRole('dialog', { name: 'Regenerate recovery codes' })
  await stepUp.getByLabel('Current password').fill(user.password)
  await stepUp.getByRole('button', { name: 'Continue' }).click()
  await stepUp.getByLabel('One-time code').pressSequentially('123456')
  await stepUp.getByRole('button', { name: 'Regenerate' }).click()
  const dialogue = page.getByRole('dialog', { name: 'Your new recovery codes' })
  await expect(dialogue).toBeVisible()
  await readSettledBox(dialogue)

  const saved = dialogue.getByRole('checkbox', { name: "I've saved my new recovery codes" })
  const lockout = dialogue.getByRole('checkbox', { name: /^I understand that losing my recovery codes/ })
  // The checkboxes end the body. Its scroll ends with the label's room whatever focus does, so blocks around
  // them put the wrapped label in the middle of the scroll
  await lockout.evaluate((element) => {
    const group = element.closest('[role="group"]')
    if (!group) throw new Error('no group around the checkbox')
    for (const place of ['before', 'after'] as const) {
      const spacer = document.createElement('div')
      spacer.style.height = '240px'
      group[place](spacer)
    }
  })
  await saved.focus()
  // The box is cut by a few pixels at the padded edge, where the browser scrolls to the nearest edge and so lines
  // up the box and leaves the end of its label under the padding
  await lockout.evaluate((element, cut) => {
    const body = element.closest('.app-modal-body')
    if (!body) throw new Error('no body around the checkbox')
    const paddedEdge = body.getBoundingClientRect().bottom - parseFloat(getComputedStyle(body).scrollPaddingBottom)
    body.scrollTop += element.getBoundingClientRect().bottom - (paddedEdge + cut)
  }, CUT_PX / 2)
  await page.keyboard.press('Tab')
  await expect(lockout).toBeFocused()
  await readSettledBox(lockout)

  const room = await lockout.evaluate((element) => {
    const body = element.closest('.app-modal-body')
    const footer = body?.querySelector('.app-modal-footer')
    const label = (element as HTMLInputElement).labels?.[0]
    if (!body || !footer || !label) throw new Error('no footer or label for the checkbox')
    const labelEnd = Math.max(label.getBoundingClientRect().bottom, element.getBoundingClientRect().bottom)
    const style = getComputedStyle(body)
    return {
      gap: footer.getBoundingClientRect().top - labelEnd,
      padding: parseFloat(style.scrollPaddingBottom) - footer.getBoundingClientRect().height,
    }
  })
  expect(room.padding, 'the body keeps room above its footer').toBeGreaterThan(0)
  expect.soft(room.gap, 'room between the end of the label and the footer').toBeGreaterThanOrEqual(room.padding - TOLERANCE_PX)
})

// The budget details dialogue scrolls its two panes as one column on a phone, where its historical utilization
// aside has padding of its own and takes over the scrolling at the end of the column
test('gives the budget details aside the scroll padding of its padding on a phone', async ({ page, request }) => {
  const user = await signUpUser(request)
  const id = await createMonthlyBudget(request, user, { name: 'Food', categoryNames: ['Groceries'], overallLimit: 50_000 })
  await page.setViewportSize(SIZES[1])
  await logInViaApi(page, user)
  await openPage(page, '/budgets')
  await page.getByTestId(`budget-card-${id}`).click()
  const dialogue = page.getByRole('dialog', { name: 'Food', exact: true })
  await expect(dialogue).toBeVisible()
  await readSettledBox(dialogue)

  const aside = await dialogue.locator('section.sticky').evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      paddingTop: parseFloat(style.paddingTop),
      paddingBottom: parseFloat(style.paddingBottom),
      scrollPaddingTop: parseFloat(style.scrollPaddingTop),
      scrollPaddingBottom: parseFloat(style.scrollPaddingBottom),
    }
  })
  expect(aside.paddingBottom).toBeGreaterThan(0)
  expect.soft(aside.scrollPaddingTop, 'aside scroll padding at the top').toBe(aside.paddingTop)
  expect.soft(aside.scrollPaddingBottom, 'aside scroll padding at the bottom').toBe(aside.paddingBottom)
})

// A connection's dialogue keeps the thing and its parts in two panes side by side from 1050px, each scrolling on
// its own, and in one column below it, where the dialogue's own scroll ends on the parts' bottom padding
for (const size of SIZES) {
  test(`gives a bank connection's panes the scroll padding of their padding at ${size.width}×${size.height}`, NEEDS_BANK_SYNC, async ({ page, request }) => {
    const user = await signUpUser(request)
    const scenario = await createSampleBridgeScenario(request)
    await claimSetupToken(request, user, scenario.setupToken, 'Joint banks')
    await page.setViewportSize(size)
    await logInViaApi(page, user)
    await openPage(page, '/settings#bank-connections')
    await page.locator('#bank-connections').getByRole('button', { name: /^Joint banks/ }).click()
    const dialogue = page.getByRole('dialog', { name: 'Joint banks', exact: true })
    await expect(dialogue).toBeVisible()
    await readSettledBox(dialogue)

    if (size.width >= 1050) {
      await expectScrollPaddingToMatchPadding(dialogue, 'Bank connection')
      return
    }
    const column = await dialogue.evaluate((panel) => {
      const scrolls = (element: Element) => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY)
      const outer = [panel, ...panel.querySelectorAll('*')].find(scrolls)
      const parts = panel.querySelector('[data-dropdown-bounds]')
      if (!outer || !parts) throw new Error('no scrolling column or parts pane in the dialogue')
      return {
        scrollPaddingBottom: parseFloat(getComputedStyle(outer).scrollPaddingBottom),
        partsPaddingBottom: parseFloat(getComputedStyle(parts).paddingBottom),
      }
    })
    expect(column.partsPaddingBottom).toBeGreaterThan(0)
    expect(column.scrollPaddingBottom, 'column scroll padding at the bottom').toBe(column.partsPaddingBottom)
  })
}

// The authenticator setup follows the step-up dialogue's password step, and each keeps a footer in both steps. A
// footer leaving as the next one arrives must not take the height that the body's scroll padding clears
test('keeps the footer height in the scroll padding after a step of the dialogue changes', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')
  await page.locator('#security').getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('button', { name: 'Enable' }).click()
  const stepUp = page.getByRole('dialog', { name: 'Turn on two-factor authentication' })
  await expect(stepUp).toBeVisible()
  await expectScrollPaddingToMatchPadding(stepUp, 'Step-up')
  await stepUp.getByLabel('Current password').fill(user.password)
  await stepUp.getByRole('button', { name: 'Continue' }).click()

  const setup = page.getByRole('dialog', { name: 'Set up two-factor authentication' })
  await expect(setup).toBeVisible()
  await expectScrollPaddingToMatchPadding(setup, 'Authenticator setup')
})

// What Tab can land on, in the order Tab visits it
const TAB_STOP_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Numbers the controls Tab visits inside a dialogue's scrolling body and returns how many there are */
function numberBodyTabStops(dialogue: Locator) {
  return dialogue.evaluate((panel, selector) => {
    const body = panel.querySelector('[data-dropdown-bounds]')
    if (!body) throw new Error('no scrolling body in the dialogue')
    const stops = Array.from(body.querySelectorAll<HTMLElement>(selector)).filter(
      (element) => element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[inert]'),
    )
    stops.forEach((stop, index) => stop.setAttribute('data-walk-stop', String(index)))
    return stops.length
  }, TAB_STOP_SELECTOR)
}

/**
 * Puts a block after every section of a dialogue body, so the body scrolls at any size and the control that opens
 * a section is not left at the end of the scroll. Edit account fits whole at 390×844 without them
 */
function padBodyToScroll(dialogue: Locator) {
  return dialogue.evaluate((panel) => {
    const body = panel.querySelector('[data-dropdown-bounds]')
    if (!body) throw new Error('no scrolling body in the dialogue')
    for (const section of Array.from(body.querySelectorAll('section'))) {
      const spacer = document.createElement('div')
      spacer.style.height = '240px'
      section.after(spacer)
    }
  })
}

/**
 * Reads what the header covers once focus has scrolled the body: the text that sits partly under the body's top
 * edge, and for a control that opens its section, whether the section's own heading is out of view
 */
function readCoveredText(focused: Locator) {
  return focused.evaluate((element, selector) => {
    let body = element.parentElement
    while (body && !['auto', 'scroll'].includes(getComputedStyle(body).overflowY)) body = body.parentElement
    if (!body) throw new Error('no scrolling body around the control')
    const edge = body.getBoundingClientRect().top
    const firstRect = (root: Element) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        const rect = Array.from(range.getClientRects()).find((box) => box.height > 4)
        if (rect) return rect
      }
      return null
    }
    const partlyUnder: string[] = []
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim()
      if (!text) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const box of range.getClientRects()) {
        if (box.height <= 4 || box.top >= edge - 1 || box.bottom <= edge + 1) continue
        // Only text that is drawn there counts, not what a closed dropdown keeps clipped out of sight
        const drawn = document.elementFromPoint(box.left + box.width / 2, (edge + box.bottom) / 2)
        if (drawn && node.parentElement?.contains(drawn)) partlyUnder.push(text)
      }
    }
    const section = element.closest('section')
    const top = element.getBoundingClientRect().top
    const opensSection =
      section !== null &&
      !Array.from(section.querySelectorAll<HTMLElement>(selector)).some(
        (other) => other !== element && other.getClientRects().length > 0 && other.getBoundingClientRect().top < top - 1,
      )
    const heading = section && opensSection ? firstRect(section) : null
    // A body at the end of its scroll could not take the control any higher, so what sits under the header is
    // where the scroll ended and not what focus left behind
    const atEnd = body.scrollTop >= body.scrollHeight - body.clientHeight - 1
    return { partlyUnder, headingOutOfView: heading ? heading.top < edge - 1 : false, opensSection, atEnd }
  }, TAB_STOP_SELECTOR)
}

/**
 * Shift+Tabs onto each control of the body in turn, with the body scrolled so that control is cut at the top,
 * and checks that nothing above it is left cut in half and that the heading of a section it opens is in view.
 * Tab onto each control cut at the bottom then checks the reveal did not push it below its padding
 */
async function expectNothingCutUnderHeader(page: Page, dialogue: Locator, name: string) {
  const count = await numberBodyTabStops(dialogue)
  expect(count, `${name} has controls in its body`).toBeGreaterThan(3)
  let sectionOpeners = 0
  for (let index = 0; index < count - 1; index += 1) {
    const stop = dialogue.locator(`[data-walk-stop="${index}"]`)
    const after = dialogue.locator(`[data-walk-stop="${index + 1}"]`)
    await after.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }))
    await cutAt(stop, 'top')
    await page.keyboard.press('Shift+Tab')
    await expect(stop, `${name}, control ${index}`).toBeFocused()
    await readSettledBox(stop)
    const covered = await readCoveredText(stop)
    if (covered.atEnd) continue
    expect.soft(covered.partlyUnder, `${name}, control ${index}: text cut in half under the header`).toEqual([])
    expect.soft(covered.headingOutOfView, `${name}, control ${index}: the heading of the section it opens`).toBe(false)
    if (covered.opensSection) sectionOpeners += 1
  }
  expect(sectionOpeners, `${name} has sections whose first control was checked`).toBeGreaterThan(0)

  for (let index = 1; index < count; index += 1) {
    const stop = dialogue.locator(`[data-walk-stop="${index}"]`)
    const before = dialogue.locator(`[data-walk-stop="${index - 1}"]`)
    await before.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }))
    await cutAt(stop, 'bottom')
    if ((await readRoom(stop)).below >= 0) continue
    await page.keyboard.press('Tab')
    await expect(stop, `${name}, control ${index}`).toBeFocused()
    await readSettledBox(stop)
    const room = await readRoom(stop)
    expect.soft(room.below, `${name}, control ${index}: room under it after Tab`).toBeGreaterThanOrEqual(room.paddingBottom - TOLERANCE_PX)
  }
}

// Whatever sits above a control, its label or the heading of its section, shows in full when focus scrolls that
// control to the top edge of the body. Each control is reached with the body scrolled so it is cut at the top,
// the position where the browser would leave its label under the header
for (const size of SIZES) {
  test(`keeps the text above a control clear of the header when Shift+Tab scrolls to it at ${size.width}×${size.height}`, async ({ page, request }) => {
    const { dialogue: transaction } = await openExpense(page, request, size)
    await expectNothingCutUnderHeader(page, transaction, 'Edit transaction')
    await closeTopDialogue(page, transaction)

    await page.getByRole('button', { name: 'Edit account', exact: true }).click()
    const account = page.getByRole('dialog', { name: 'Edit account', exact: true })
    await expect(account).toBeVisible()
    await readSettledBox(account)
    await padBodyToScroll(account)
    await expectNothingCutUnderHeader(page, account, 'Edit account')
  })
}
