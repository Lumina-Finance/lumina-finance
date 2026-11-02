// Entering a transaction from the keyboard alone: shortcuts that jump to each field, a date that steps by a day,
// Alt+Enter to save, and every dropdown choosing and closing by key, with the key caps shown only while the
// action key is held. Every key is a real key press
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openModal, openPage } from '../support/app'
import { faintestText } from '../support/contrast'
import { AT_EVERY_SIZE } from '../support/sizes'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only, apart from the test of where the hints show. That one reads the screen's width and
// pointer, so it runs at every size. The keys are the same at every size

type User = Awaited<ReturnType<typeof signUpUser>>

type SavedTransaction = {
  id: string
  dt: string
  amount: number
  notes: string | null
  tags: { name: string }[]
}

/**
 * Signs up a user with two accounts and a tag, signs in and opens the Add transaction dialogue
 *
 * @param actionKey - The key the user chose in Settings, left out for the default
 * @param extra - Further tags and merchants to create beside the Holiday tag
 */
async function openAddDialogue(
  page: Page,
  request: APIRequestContext,
  actionKey?: 'left-alt',
  extra: { tags?: string[]; merchants?: string[] } = {},
) {
  const user = await signUpUser(request)
  if (actionKey) {
    const saved = await request.patch(`${API_BASE_URL}/me`, { headers: asUser(user), data: { action_key: actionKey } })
    expect(saved.status()).toBe(200)
  }
  const everyday = await createAccount(request, user, { name: 'Everyday Chequing' })
  await createAccount(request, user, { name: 'Holiday Savings' })
  const tag = await request.post(`${API_BASE_URL}/tags`, { headers: asUser(user), data: { name: 'Holiday' } })
  expect(tag.status()).toBe(201)
  for (const [path, names] of [
    ['tags', extra.tags ?? []],
    ['merchants', extra.merchants ?? []],
  ] as const) {
    for (const name of names) {
      const created = await request.post(`${API_BASE_URL}/${path}`, { headers: asUser(user), data: { name } })
      expect(created.status()).toBe(201)
    }
  }

  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
  return { user, dialog, everyday }
}

/** Reads the date field's three segments as yyyy-mm-dd */
async function readDateOnce(dialog: Locator): Promise<string> {
  const group = dialog.getByRole('group', { name: 'Date', exact: true })
  const [year, month, day] = await Promise.all(
    ['Year', 'Month', 'Day'].map((name) => group.getByRole('textbox', { name, exact: true }).inputValue()),
  )
  return `${year}-${month}-${day}`
}

/** Reads the date once a key press has finished rendering, which is when two reads a moment apart agree */
async function readDate(dialog: Locator): Promise<string> {
  let value = await readDateOnce(dialog)
  for (;;) {
    await dialog.page().waitForTimeout(150)
    const next = await readDateOnce(dialog)
    if (next === value) return value
    value = next
  }
}

/** Lists the transactions of an account as the server holds them */
async function listSaved(request: APIRequestContext, user: User, accountId: string): Promise<SavedTransaction[]> {
  const response = await request.get(`${API_BASE_URL}/transactions?account_id=${accountId}`, {
    headers: asUser(user),
  })
  expect(response.status()).toBe(200)
  return (await response.json()) as SavedTransaction[]
}

/** Opens a dropdown with its shortcut, types to filter it and chooses the highlighted option with Enter */
async function chooseByKeys(page: Page, dialog: Locator, shortcut: string, search: string, option: string) {
  await page.keyboard.press(shortcut)
  // A list that has just closed can linger on the page, so the open one is the one holding the cursor
  const open = dialog.locator('.app-dropdown-slot:has(input[data-dropdown-search]:focus)')
  await expect(open).toHaveCount(1)
  await page.keyboard.type(search)
  await expect(open.getByRole('option', { name: option, exact: true })).toBeVisible()
  await page.keyboard.press('Enter')
  await expectNoOpenList(dialog)
}

/** Closed is what the trigger reports, since a list leaves the page only after its exit animation */
async function expectNoOpenList(dialog: Locator) {
  await expect(dialog.locator('[role="combobox"][aria-expanded="true"]')).toHaveCount(0)
}

test('enters a whole transaction from the keyboard and saves it with Alt+Enter', async ({ page, request }) => {
  const { user, dialog, everyday } = await openAddDialogue(page, request)

  await chooseByKeys(page, dialog, 'Alt+KeyA', 'Everyday', 'Everyday Chequing')
  await expect(dialog.getByRole('combobox', { name: 'Account' })).toContainText('Everyday Chequing')
  await chooseByKeys(page, dialog, 'Alt+KeyM', 'Unknown', 'Unknown')
  await chooseByKeys(page, dialog, 'Alt+KeyC', 'Groc', 'Groceries')
  await chooseByKeys(page, dialog, 'Alt+KeyG', 'Holi', 'Holiday')
  await expect(dialog.getByRole('button', { name: 'Remove Holiday' })).toBeVisible()

  // Two days back and one forward, from the date the dialogue opens on
  await page.keyboard.press('Alt+KeyW')
  await expect(dialog.getByRole('textbox', { name: 'Year', exact: true })).toBeFocused()
  expect(await readDate(dialog)).toBe(daysFromTodayInTestTimezone(0))
  await page.keyboard.press('BracketLeft')
  await page.keyboard.press('BracketLeft')
  expect(await readDate(dialog)).toBe(daysFromTodayInTestTimezone(-2))
  await page.keyboard.press('BracketRight')
  expect(await readDate(dialog)).toBe(daysFromTodayInTestTimezone(-1))

  await page.keyboard.press('Alt+KeyP')
  await expect(dialog.getByRole('textbox', { name: 'Amount', exact: true })).toBeFocused()
  await page.keyboard.type('12.50')
  await page.keyboard.press('Alt+KeyL')
  await page.keyboard.type('Entered with the keyboard')

  const saved = page.waitForResponse(
    (response) => response.url() === `${API_BASE_URL}/transactions` && response.request().method() === 'POST',
  )
  await page.keyboard.press('Alt+Enter')
  expect((await saved).status()).toBe(201)
  await expect(dialog).toBeHidden()

  const [row] = await listSaved(request, user, everyday.id)
  expect(row.amount).toBe(-1250)
  expect(row.dt).toBe(daysFromTodayInTestTimezone(-1))
  expect(row.notes).toBe('Entered with the keyboard')
  expect(row.tags.map((tag) => tag.name)).toEqual(['Holiday'])
})

test('refuses Alt+Enter while a field is still missing, then saves once it is filled', async ({ page, request }) => {
  const { user, dialog, everyday } = await openAddDialogue(page, request)
  const requests: string[] = []
  page.on('request', (sent) => sent.method() === 'POST' && requests.push(sent.url()))

  // Nothing is chosen yet, so the press is refused the way a click on Add transaction is
  await page.keyboard.press('Alt+Enter')
  await expect(dialog.getByRole('combobox', { name: 'Account' })).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog.getByRole('combobox', { name: 'Account' })).toBeFocused()
  expect(requests.filter((url) => url === `${API_BASE_URL}/transactions`)).toEqual([])

  await chooseByKeys(page, dialog, 'Alt+KeyA', 'Everyday', 'Everyday Chequing')
  await chooseByKeys(page, dialog, 'Alt+KeyM', 'Unknown', 'Unknown')
  await chooseByKeys(page, dialog, 'Alt+KeyC', 'Groc', 'Groceries')
  await page.keyboard.press('Alt+KeyP')
  await page.keyboard.type('3')

  const saved = page.waitForResponse(
    (response) => response.url() === `${API_BASE_URL}/transactions` && response.request().method() === 'POST',
  )
  await page.keyboard.press('Alt+Enter')
  expect((await saved).status()).toBe(201)
  await expect(dialog).toBeHidden()
  expect((await listSaved(request, user, everyday.id)).map((row) => row.amount)).toEqual([-300])
})

test('does not save with Alt+Enter while a dropdown list is open', async ({ page, request }) => {
  const { dialog } = await openAddDialogue(page, request)
  const posted: string[] = []
  page.on('request', (sent) => sent.method() === 'POST' && posted.push(sent.url()))

  await page.keyboard.press('Alt+KeyC')
  await expect(dialog.getByRole('option').first()).toBeVisible()
  await page.keyboard.press('Alt+Enter')
  await expect(dialog.getByRole('option').first()).toBeVisible()
  await expect(dialog.getByRole('combobox', { name: 'Account' })).not.toHaveAttribute('aria-invalid', 'true')
  expect(posted).toEqual([])
})

test('collapses the other account dropdown of a transfer with Alt+O, and swaps lists with Alt+A', async ({
  page,
  request,
}) => {
  const { dialog } = await openAddDialogue(page, request)
  await page.keyboard.press('Alt+KeyY')
  await page.keyboard.press('Alt+KeyY')
  await expect(dialog.getByRole('tab', { name: 'Transfer' })).toHaveAttribute('aria-selected', 'true')
  const other = dialog.locator('#txn-counterparty-account')
  const account = dialog.locator('#txn-account')

  await page.keyboard.press('Alt+KeyO')
  await expect(other).toHaveAttribute('aria-expanded', 'true')
  const search = dialog.locator('input[data-dropdown-search]:focus')
  await expect(search).toHaveCount(1)
  await page.keyboard.type('zz')
  await expect(search).toHaveValue('zz')

  // The same chord again collapses the list, keeps the dialogue open and leaves focus on the field
  await page.keyboard.press('Alt+KeyO')
  await expectNoOpenList(dialog)
  await expect(other).toBeFocused()
  await expect(dialog).toBeVisible()

  // A third press opens it again with the search cleared, and the Account chord moves on to its list
  await page.keyboard.press('Alt+KeyO')
  await expect(other).toHaveAttribute('aria-expanded', 'true')
  await expect(dialog.locator('input[data-dropdown-search]:focus')).toHaveValue('')
  await page.keyboard.press('Alt+KeyA')
  await expect(account).toHaveAttribute('aria-expanded', 'true')
  await expect(other).toHaveAttribute('aria-expanded', 'false')

  // And the other account's chord closes the Account list in turn
  await page.keyboard.press('Alt+KeyO')
  await expect(other).toHaveAttribute('aria-expanded', 'true')
  await expect(account).toHaveAttribute('aria-expanded', 'false')
})

test('closes an open dropdown on Escape before it closes the dialogue', async ({ page, request }) => {
  const { dialog } = await openAddDialogue(page, request)

  // Tags wait for an account, so one is chosen first
  await chooseByKeys(page, dialog, 'Alt+KeyA', 'Everyday', 'Everyday Chequing')

  for (const shortcut of ['Alt+KeyA', 'Alt+KeyM', 'Alt+KeyC', 'Alt+KeyG']) {
    await page.keyboard.press(shortcut)
    await expect(dialog.getByRole('option').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expectNoOpenList(dialog)
    await expect(dialog).toBeVisible()
  }

  // With nothing open, the same key closes the dialogue
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

for (const [setting, chord] of [
  [undefined, 'Alt'],
  ['left-alt', 'AltLeft'],
] as const) {
  test(`collapses a dropdown when its shortcut is pressed again, with ${chord} as the action key`, async ({
    page,
    request,
  }) => {
    const { dialog } = await openAddDialogue(page, request, setting)

    // Tags wait for an account, so one is chosen first
    await chooseByKeys(page, dialog, `${chord}+KeyA`, 'Everyday', 'Everyday Chequing')

    for (const [name, key] of [
      ['Account', 'KeyA'],
      ['Merchant', 'KeyM'],
      ['Category', 'KeyC'],
      ['Tags', 'KeyG'],
    ] as const) {
      const field = dialog.getByRole('combobox', { name })

      await page.keyboard.press(`${chord}+${key}`)
      await expect(field).toHaveAttribute('aria-expanded', 'true')
      const search = dialog.locator('input[data-dropdown-search]:focus')
      await expect(search).toHaveCount(1)
      await page.keyboard.type('zz')
      await expect(search).toHaveValue('zz')

      // The same chord again collapses the list, keeps the dialogue open and leaves focus on the field
      await page.keyboard.press(`${chord}+${key}`)
      await expectNoOpenList(dialog)
      await expect(field).toBeFocused()
      await expect(dialog).toBeVisible()

      // A third press opens it again, with the search text cleared as on any other close
      await page.keyboard.press(`${chord}+${key}`)
      await expect(field).toHaveAttribute('aria-expanded', 'true')
      await expect(dialog.locator('input[data-dropdown-search]:focus')).toHaveValue('')
      await page.keyboard.press('Escape')
      await expectNoOpenList(dialog)
    }

    // Another dropdown's chord still moves on to that one
    await page.keyboard.press(`${chord}+KeyC`)
    await expect(dialog.getByRole('combobox', { name: 'Category' })).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press(`${chord}+KeyM`)
    await expect(dialog.getByRole('combobox', { name: 'Merchant' })).toHaveAttribute('aria-expanded', 'true')
    await expect(dialog.getByRole('combobox', { name: 'Category' })).toHaveAttribute('aria-expanded', 'false')
  })
}

test('picks a tag with the keyboard from a list opened by a click', async ({ page, request }) => {
  const { dialog } = await openAddDialogue(page, request)

  await dialog.getByRole('combobox', { name: 'Account' }).click()
  await dialog.getByRole('option', { name: 'Everyday Chequing', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Tags' }).click()
  await expect(dialog.getByPlaceholder('Search tags...')).toBeFocused()
  await page.keyboard.type('Holi')
  // Enter chooses what the search has narrowed to, so it waits for the narrowing to finish
  const open = dialog.locator('.app-dropdown-slot:has(input[data-dropdown-search]:focus)')
  await expect(open.getByRole('option')).toHaveCount(1)
  await expect(open.getByRole('option', { name: 'Holiday', exact: true })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('button', { name: 'Remove Holiday' })).toBeVisible()
})

test('jumps to another field with its shortcut while a dropdown is open, closing that dropdown', async ({ page, request }) => {
  const { dialog } = await openAddDialogue(page, request)

  await page.keyboard.press('Alt+KeyC')
  await expect(dialog.getByRole('option').first()).toBeVisible()
  await page.keyboard.press('Alt+KeyP')
  await expectNoOpenList(dialog)
  await expect(dialog.getByRole('textbox', { name: 'Amount', exact: true })).toBeFocused()

  // The shortcut for the amount field also works from inside a text field
  await page.keyboard.press('Alt+KeyL')
  await expect(dialog.getByRole('textbox', { name: 'Notes', exact: true })).toBeFocused()
})

test('types the shortcut letters and signs into a text field as ordinary characters, apart from the brackets', async ({ page, request }) => {
  const { dialog } = await openAddDialogue(page, request)
  const today = daysFromTodayInTestTimezone(0)

  await page.keyboard.press('Alt+KeyL')
  const notes = dialog.getByRole('textbox', { name: 'Notes', exact: true })
  await page.keyboard.type('wpl tgc a-b+c=t')
  await expect(notes).toHaveValue('wpl tgc a-b+c=t')
  expect(await readDate(dialog)).toBe(today)
  await expect(dialog).toBeVisible()

  // Brackets are the date's from every field, so they type nothing in Notes and step the date there
  await page.keyboard.type('[x]')
  await expect(notes).toHaveValue('wpl tgc a-b+c=tx')
  expect(await readDate(dialog)).toBe(today)

  // Browser zoom keys and a Command or Control chord are the browser's, so none of them moves the date
  await page.keyboard.press('Alt+KeyW')
  await page.keyboard.press('Control+Minus')
  await page.keyboard.press('Meta+Equal')
  await page.keyboard.press('Control+BracketLeft')
  await page.keyboard.press('Meta+BracketRight')
  expect(await readDate(dialog)).toBe(today)
})

test('steps the date by a day with [ and ], and jumps to today with t', async ({ page, request }) => {
  const { dialog } = await openAddDialogue(page, request)

  await page.keyboard.press('Alt+KeyW')
  await page.keyboard.press('BracketRight')
  await page.keyboard.press('BracketRight')
  expect(await readDate(dialog)).toBe(daysFromTodayInTestTimezone(2))
  await page.keyboard.press('BracketLeft')
  expect(await readDate(dialog)).toBe(daysFromTodayInTestTimezone(1))
  await page.keyboard.press('KeyT')
  expect(await readDate(dialog)).toBe(daysFromTodayInTestTimezone(0))

  // The old keys no longer step: Alt plus comma or period, and a - that only moves on to the next segment
  await page.keyboard.press('Alt+Period')
  await page.keyboard.press('Alt+Comma')
  await page.keyboard.press('Minus')
  expect(await readDate(dialog)).toBe(daysFromTodayInTestTimezone(0))
  await page.keyboard.press('Alt+KeyW')

  // Typed digits are typing, and a bracket straight after them still steps the date they made
  await page.keyboard.type('20271231')
  await page.keyboard.press('BracketRight')
  expect(await readDate(dialog)).toBe('2028-01-01')
  await page.keyboard.press('BracketLeft')
  expect(await readDate(dialog)).toBe('2027-12-31')
})

/** Records every value the date field's highlight attribute takes, with the time it took it, from now on */
async function watchDateHighlight(dateField: Locator) {
  await dateField.evaluate((el) => {
    const history: { value: string | null; at: number }[] = []
    ;(window as unknown as { dateHighlightHistory: typeof history }).dateHighlightHistory = history
    new MutationObserver(() =>
      history.push({ value: el.getAttribute('data-step-highlight'), at: performance.now() }),
    ).observe(el, { attributes: true, attributeFilter: ['data-step-highlight'] })
  })
  return () =>
    dateField.page().evaluate(
      () =>
        (window as unknown as { dateHighlightHistory: { value: string | null; at: number }[] }).dateHighlightHistory,
    )
}

/** Reads a settled border colour of the date field, which is the focus colour while it is lit */
async function readDateBorder(dateField: Locator) {
  return dateField.evaluate((el) => getComputedStyle(el).borderTopColor)
}

/** Reads the border colour once its fade has finished, which is when two reads a moment apart agree */
async function readSettledDateBorder(dateField: Locator) {
  let colour = await readDateBorder(dateField)
  for (;;) {
    await dateField.page().waitForTimeout(150)
    const next = await readDateBorder(dateField)
    if (next === colour) return colour
    colour = next
  }
}

/** Looks at every frame for the border to reach a colour within the time, since a fade passes through shades of it */
async function borderReaches(dateField: Locator, colour: string, withinMs: number) {
  return dateField.evaluate(
    async (el, args) => {
      const end = performance.now() + args.withinMs
      while (performance.now() < end) {
        if (getComputedStyle(el).borderTopColor === args.colour) return true
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      return false
    },
    { colour, withinMs },
  )
}

test('lights the date field with its focus look when [ or ] steps it from another field, keeping focus where it was', async ({
  page,
  request,
}) => {
  const { dialog } = await openAddDialogue(page, request)
  const dateField = dialog.getByRole('group', { name: 'Date', exact: true })
  const notes = dialog.getByRole('textbox', { name: 'Notes', exact: true })

  // The colour focus gives the date's border, read from the same token, and the colour it has at rest
  const focused = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--app-focus-ring)'
    document.body.append(probe)
    const colour = getComputedStyle(probe).color
    probe.remove()
    return colour
  })
  await page.keyboard.press('Alt+KeyW')
  await expect.poll(() => readDateBorder(dateField)).toBe(focused)
  await page.keyboard.press('Alt+KeyL')
  await expect(notes).toBeFocused()
  await expect.poll(() => readDateBorder(dateField)).not.toBe(focused)
  await expect(dateField).not.toHaveAttribute('data-step-highlight', /.+/)
  const rest = await readSettledDateBorder(dateField)

  const readHistory = await watchDateHighlight(dateField)

  // Watched from before the presses, since the light is gone sooner than a check after them could land
  const reachedFocusLook = borderReaches(dateField, focused, 2_000)

  // Spaced so each press keeps the light on past its ease in, which a lone press only just reaches
  await page.keyboard.press('BracketRight', { delay: 100 })
  await page.keyboard.press('BracketRight', { delay: 100 })
  await page.keyboard.press('BracketLeft')

  // Lit with the focus look, while the cursor never left Notes and typed nothing
  expect(await reachedFocusLook).toBe(true)
  await expect(notes).toBeFocused()
  await expect(notes).toHaveValue('')
  expect(await readDate(dialog)).toBe(daysFromTodayInTestTimezone(1))

  // Then it eases out to how it rests, and the presses in a row lit it once rather than blinking it
  await expect.poll(() => readDateBorder(dateField), { timeout: 5_000 }).toBe(rest)
  await expect(dateField).not.toHaveAttribute('data-step-highlight', /.+/)
  const history = await readHistory()
  expect(history.map((entry) => entry.value)).toEqual(['lit', 'fading', null])
  expect(history[1].at - history[0].at).toBeGreaterThanOrEqual(150)
  expect(history[2].at - history[1].at).toBeGreaterThanOrEqual(100)
  await expect(notes).toBeFocused()
})

test('lights the date field at once and clears it at once under reduced motion', async ({ page, request }) => {
  const { dialog } = await openAddDialogue(page, request)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const dateField = dialog.getByRole('group', { name: 'Date', exact: true })

  await page.keyboard.press('Alt+KeyL')
  const readHistory = await watchDateHighlight(dateField)
  await page.keyboard.press('BracketRight')
  await expect.poll(async () => (await readHistory()).map((entry) => entry.value)).toEqual(['lit', null])
})

test('keeps - as the separator when a date is typed', async ({ page, request }) => {
  const { dialog } = await openAddDialogue(page, request)

  // 1, then - to move on to the day, then 5: a step would have moved the date a day back instead
  await page.keyboard.press('Alt+KeyW')
  await page.keyboard.type('2026')
  await page.keyboard.type('1-5')
  expect(await readDate(dialog)).toBe('2026-1-5')

  // A - straight after focus is the separator too, not a step back
  await page.keyboard.press('Alt+KeyL')
  await page.keyboard.press('Alt+KeyW')
  await page.keyboard.press('Minus')
  expect(await readDate(dialog)).toBe('2026-01-05')
})

test('steps the date of a transaction being edited and saves it with Alt+Enter', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4200,
    date: daysFromTodayInTestTimezone(-5),
  })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await page.getByTestId(`transaction-row-${id}`).click()
  const dialog = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
  await expect(dialog).toBeVisible()

  // The form fills in from the saved transaction, so it is stepped only once it has
  expect(await readDate(dialog)).toBe(daysFromTodayInTestTimezone(-5))
  await page.keyboard.press('Alt+KeyW')
  await page.keyboard.press('BracketRight')
  expect(await readDate(dialog)).toBe(daysFromTodayInTestTimezone(-4))

  const saved = page.waitForResponse(
    (response) => response.url() === `${API_BASE_URL}/transactions/${id}` && response.request().method() === 'PATCH',
  )
  await page.keyboard.press('Alt+Enter')
  expect((await saved).status()).toBe(200)
  await expect(dialog).toBeHidden()
  const [row] = await listSaved(request, user, account.id)
  expect(row.dt).toBe(daysFromTodayInTestTimezone(-4))
})

test('cycles Type and Direction with each press of their shortcut, wrapping round, as a click would', async ({
  page,
  request,
}) => {
  const { dialog } = await openAddDialogue(page, request)
  const type = dialog.getByRole('tablist', { name: 'Transaction type' })
  const direction = dialog.getByRole('tablist', { name: 'Transaction direction' })
  const chosen = (list: Locator, name: string) =>
    expect(list.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')

  // Focus stays in the field being typed in, so no focus ring shows on either group
  const notes = dialog.getByRole('textbox', { name: 'Notes', exact: true })
  await page.keyboard.press('Alt+KeyL')
  await expect(notes).toBeFocused()

  await chosen(type, 'Expense')
  await page.keyboard.press('Alt+KeyY')
  await chosen(type, 'Income')
  await expect(notes).toBeFocused()
  await page.keyboard.press('Alt+KeyY')
  await chosen(type, 'Transfer')

  // The form answers as it does to a click: a transfer asks for the other account
  await expect(dialog.locator('#txn-counterparty-account')).toBeVisible()
  await page.keyboard.press('Alt+KeyY')
  await chosen(type, 'Expense')

  await chosen(direction, 'Debit')
  await page.keyboard.press('Alt+KeyR')
  await chosen(direction, 'Credit')
  await expect(notes).toBeFocused()
  await page.keyboard.press('Alt+KeyR')
  await chosen(direction, 'Debit')
})

test('moves between the type and direction choices with the arrow keys', async ({ page, request }) => {
  const { dialog } = await openAddDialogue(page, request)
  const type = dialog.getByRole('tablist', { name: 'Transaction type' })
  const direction = dialog.getByRole('tablist', { name: 'Transaction direction' })

  await type.getByRole('tab', { name: 'Expense' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(type.getByRole('tab', { name: 'Income' })).toHaveAttribute('aria-selected', 'true')
  await expect(type.getByRole('tab', { name: 'Income' })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(type.getByRole('tab', { name: 'Transfer' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(type.getByRole('tab', { name: 'Transfer' })).toBeFocused()

  // A transfer records the account it touched, and its own shortcut reaches that field
  await page.keyboard.press('Alt+KeyO')
  await expect(dialog.getByRole('option').first()).toBeVisible()
  await page.keyboard.press('Escape')

  await direction.getByRole('tab', { name: 'Debit' }).focus()
  const credit = direction.getByRole('tab', { name: 'Credit' })
  await page.keyboard.press('ArrowRight')
  await expect(credit).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(direction.getByRole('tab', { name: 'Debit' })).toHaveAttribute('aria-selected', 'true')
})


/** The key caps on show. A cap that is faded out or laid out of the page does not count */
function visibleCaps(dialog: Locator) {
  return dialog.locator('kbd').filter({ visible: true })
}

/** Reads where every label, field and button of the dialogue sits, once its opening animation has settled */
async function measureLayout(dialog: Locator): Promise<string> {
  let layout = await readLayoutOnce(dialog)
  for (;;) {
    await dialog.page().waitForTimeout(150)
    const next = await readLayoutOnce(dialog)
    if (next === layout) return layout
    layout = next
  }
}

/** Reads the position and size of every label, field and button of the dialogue at this moment */
async function readLayoutOnce(dialog: Locator): Promise<string> {
  return dialog.evaluate((root) =>
    JSON.stringify(
      Array.from(root.querySelectorAll('h2, p, label, input, button, [role="combobox"], [role="tablist"]')).map(
        (element) => {
          const box = element.getBoundingClientRect()
          return [element.tagName, box.x, box.y, box.width, box.height]
        },
      ),
    ),
  )
}

/** Notes holds focus, which is inside the form where the action key is heard, and the key caps are not yet shown */
async function focusFormAndExpectNoCaps(page: Page, dialog: Locator) {
  await page.keyboard.press('Alt+KeyL')
  await expect(dialog.getByRole('textbox', { name: 'Notes', exact: true })).toBeFocused()
  await expect(visibleCaps(dialog)).toHaveCount(0)
}

const HINT_LONG_PRESS_MS = 300

test('shows no key cap at rest, and keeps the footer and the save button as they were without them', async ({
  page,
  request,
}) => {
  const { dialog } = await openAddDialogue(page, request)
  const submit = dialog.getByTestId('transaction-submit')

  await expect(dialog.locator('kbd').first()).toBeAttached()
  await expect(visibleCaps(dialog)).toHaveCount(0)

  // Nothing sits inside the button, which is as wide as it was before any key cap
  await measureLayout(dialog)
  await expect(submit.locator('kbd')).toHaveCount(0)
  expect((await submit.boundingBox())?.width).toBe(176)
  await expect(submit).toHaveText('Add transaction')
})

test('shows the key caps after a long press of the action key without moving anything, and hides them on release', async ({
  page,
  request,
}) => {
  const { dialog } = await openAddDialogue(page, request)
  await focusFormAndExpectNoCaps(page, dialog)
  const atRest = await measureLayout(dialog)

  await page.keyboard.down('Alt')
  await page.waitForTimeout(HINT_LONG_PRESS_MS - 200)
  await expect(visibleCaps(dialog)).toHaveCount(0)

  const texts = [/Type\s*Alt\+Y/, /Direction\s*Alt\+R/, 'Alt+A', 'Alt+M', 'Alt+C', 'Alt+G', 'Alt+W', 'Alt+P', 'Alt+L', 'Alt+Enter']
  for (const text of texts) {
    await expect(visibleCaps(dialog).filter({ hasText: text })).toHaveCount(1)
  }
  // The date shows one cap, and none for stepping
  await expect(visibleCaps(dialog).filter({ hasText: /^Alt\+,/ })).toHaveCount(0)
  await expect(dialog.locator('kbd').filter({ hasText: /,\/\./ })).toHaveCount(0)
  for (const cap of await dialog.locator('kbd').all()) await expect(cap).toHaveCSS('opacity', '1')
  expect(await measureLayout(dialog)).toBe(atRest)

  await page.keyboard.up('Alt')
  await expect(visibleCaps(dialog)).toHaveCount(0)
  expect(await measureLayout(dialog)).toBe(atRest)

  // Every key cap is text and reads at 4.5 to 1 or better in both themes
  await page.keyboard.down('Alt')
  await expect(visibleCaps(dialog).first()).toBeVisible()
  for (const cap of await dialog.locator('kbd').all()) await expect(cap).toHaveCSS('opacity', '1')
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    for (const cap of await visibleCaps(dialog).all()) {
      expect((await faintestText(cap)).contrast).toBeGreaterThanOrEqual(4.5)
    }
  }
  await page.keyboard.up('Alt')
})

test('never shows the key caps for a chord, and holds the release of a long press from the browser menu', async ({
  page,
  request,
}) => {
  const { dialog } = await openAddDialogue(page, request)
  await focusFormAndExpectNoCaps(page, dialog)
  await page.evaluate(() => {
    const seen: boolean[] = []
    Object.assign(window, { altReleases: seen })
    window.addEventListener('keyup', (event) => event.key === 'Alt' && seen.push(event.defaultPrevented))
  })
  const releases = () => page.evaluate(() => (window as unknown as { altReleases: boolean[] }).altReleases)

  // A user who knows the key presses a letter at once and lets go, and never sees the caps flash
  await page.keyboard.press('Alt+KeyP')
  await page.waitForTimeout(HINT_LONG_PRESS_MS + 300)
  await expect(visibleCaps(dialog)).toHaveCount(0)
  expect(await releases()).toEqual([true])

  // Held long, the release is taken, so a browser that opens its menu when Alt comes up alone does not
  await page.keyboard.down('Alt')
  await expect(visibleCaps(dialog).first()).toBeVisible()
  await page.keyboard.up('Alt')
  expect(await releases()).toEqual([true, true])
})

test('hides the key caps when the window loses focus while the action key is held', async ({ page, request }) => {
  const { dialog } = await openAddDialogue(page, request)
  await focusFormAndExpectNoCaps(page, dialog)

  await page.keyboard.down('Alt')
  await expect(visibleCaps(dialog).first()).toBeVisible()

  // The release would go to another window, so the caps must not wait for it
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(visibleCaps(dialog)).toHaveCount(0)
  await page.keyboard.up('Alt')
})

test('follows the action key chosen in Settings, so the other Alt key does nothing', async ({ page, request }) => {
  const { dialog } = await openAddDialogue(page, request, 'left-alt')
  await focusFormAndExpectNoCaps(page, dialog)
  const amount = dialog.getByRole('textbox', { name: 'Amount', exact: true })

  // The right Alt key is typing: it jumps nowhere and shows no key caps however long it is held
  await page.keyboard.down('AltRight')
  await page.keyboard.press('KeyP')
  await expect(amount).not.toBeFocused()
  await page.waitForTimeout(HINT_LONG_PRESS_MS + 300)
  await expect(visibleCaps(dialog)).toHaveCount(0)
  await page.keyboard.up('AltRight')

  await page.keyboard.press('AltLeft+KeyP')
  await expect(amount).toBeFocused()

  await page.keyboard.down('AltLeft')
  await expect(visibleCaps(dialog).filter({ hasText: 'Alt+Enter' })).toHaveCount(1)
  await page.keyboard.up('AltLeft')
  await expect(visibleCaps(dialog)).toHaveCount(0)
})

test('saves the action key chosen in Settings', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#profile')

  await page.getByRole('combobox', { name: 'Action key' }).click()
  await page.getByText('Left Alt', { exact: true }).click()
  await page.locator('#profile').getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('#profile').getByLabel('Saved')).toBeVisible()

  const me = await request.get(`${API_BASE_URL}/me`, { headers: asUser(user) })
  expect(((await me.json()) as { action_key: string }).action_key).toBe('left-alt')
})

test('shows key caps only where a keyboard can be attached, and none on a phone', AT_EVERY_SIZE, async ({ page, request }) => {
  const { dialog } = await openAddDialogue(page, request)

  // Shown from 40rem wide and only where a precise pointer, so a keyboard, can be attached
  const showsHints = await page.evaluate(() => matchMedia('(min-width: 40rem) and (any-pointer: fine)').matches)
  await expect(dialog.locator('kbd').first()).toBeAttached()
  await expect(visibleCaps(dialog)).toHaveCount(0)

  await page.keyboard.press('Alt+KeyL')
  await page.keyboard.down('Alt')
  await page.waitForTimeout(HINT_LONG_PRESS_MS + 300)
  if (showsHints) {
    await expect(visibleCaps(dialog).first()).toBeVisible()
  } else {
    await expect(visibleCaps(dialog)).toHaveCount(0)
  }
  await page.keyboard.up('Alt')

  // The hints are for sighted users, and the controls carry the shortcut for assistive technology
  await expect(dialog.getByTestId('transaction-submit')).toHaveAttribute('aria-keyshortcuts', 'Alt+Enter')
  await expect(dialog.getByRole('combobox', { name: 'Category' })).toHaveAttribute('aria-keyshortcuts', 'Alt+C')
  await expect(dialog.getByTestId('transaction-submit')).toHaveAccessibleName('Add transaction')
})

test('jumps with the key events a Mac keyboard sends, Option held past the key caps and kept down between chords', async ({
  page,
  request,
}) => {
  const { dialog } = await openAddDialogue(page, request)
  const session = await page.context().newCDPSession(page)
  const option = { key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, location: 1 }

  // Option turns the letter into another character, so `key` is ∑ and only `code` still says W
  const chord = async (key: string, code: string, keyCode: number) => {
    const letter = { key, code, windowsVirtualKeyCode: keyCode, modifiers: 1, text: key }
    await session.send('Input.dispatchKeyEvent', { type: 'keyDown', ...letter })
    await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...letter })
  }

  await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...option, modifiers: 1 })
  await expect(visibleCaps(dialog).first()).toBeVisible()
  await chord('∑', 'KeyW', 87)
  await expect(dialog.getByRole('textbox', { name: 'Year', exact: true })).toBeFocused()
  await chord('π', 'KeyP', 80)
  await expect(dialog.getByRole('textbox', { name: 'Amount', exact: true })).toBeFocused()
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...option, modifiers: 0 })
  await expect(visibleCaps(dialog)).toHaveCount(0)
})

test('shows the key caps and jumps with Alt+W when focus is on the page body or on blank dialogue space', async ({
  page,
  request,
}) => {
  const { dialog } = await openAddDialogue(page, request)
  await page.keyboard.press('Alt+KeyL')

  // Focus on the body, as after the focused field is blurred
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
  await page.keyboard.down('Alt')
  await expect(visibleCaps(dialog).first()).toBeVisible()
  await page.keyboard.up('Alt')
  await expect(visibleCaps(dialog)).toHaveCount(0)
  await page.keyboard.press('Alt+KeyW')
  await expect(dialog.getByRole('textbox', { name: 'Year', exact: true })).toBeFocused()

  // A click on blank space inside the dialogue leaves focus on nothing
  await dialog.getByRole('heading').first().click()
  await page.keyboard.down('Alt')
  await expect(visibleCaps(dialog).first()).toBeVisible()
  await page.keyboard.up('Alt')
  await page.keyboard.press('Alt+KeyP')
  await expect(dialog.getByRole('textbox', { name: 'Amount', exact: true })).toBeFocused()
})

test('shows no key cap and takes no chord once the dialogue is closed', async ({ page, request }) => {
  const { dialog } = await openAddDialogue(page, request)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.evaluate(() => {
    const seen: boolean[] = []
    Object.assign(window, { chordsTaken: seen })
    window.addEventListener('keydown', (event) => event.code === 'KeyW' && seen.push(event.defaultPrevented))
  })

  await page.keyboard.down('Alt')
  await page.waitForTimeout(HINT_LONG_PRESS_MS + 300)
  await page.keyboard.press('KeyW')
  await page.keyboard.up('Alt')
  expect(await page.evaluate(() => (window as unknown as { chordsTaken: boolean[] }).chordsTaken)).toEqual([false])
  await expect(page.locator('kbd').filter({ visible: true })).toHaveCount(0)
})

test('steps the date with [ and ] from Notes, the amount and a dropdown search, typing neither character', async ({
  page,
  request,
}) => {
  const { dialog } = await openAddDialogue(page, request)

  await page.keyboard.press('Alt+KeyL')
  await page.keyboard.type('a[b]c')
  await expect(dialog.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('abc')
  expect(await readDate(dialog)).toBe(daysFromTodayInTestTimezone(0))

  await page.keyboard.press('BracketRight')
  expect(await readDate(dialog)).toBe(daysFromTodayInTestTimezone(1))
  await page.keyboard.press('Alt+KeyP')
  await page.keyboard.press('BracketLeft')
  await page.keyboard.press('BracketLeft')
  expect(await readDate(dialog)).toBe(daysFromTodayInTestTimezone(-1))

  await page.keyboard.press('Alt+KeyM')
  const search = dialog.getByPlaceholder('Search merchants...')
  await expect(search).toBeFocused()
  await page.keyboard.type('Cafe[')
  await expect(search).toHaveValue('Cafe')
  expect(await readDate(dialog)).toBe(daysFromTodayInTestTimezone(-2))
})

test('adds no tag from an Enter pressed before the Tags search has narrowed, then adds the one typed', async ({
  page,
  request,
}) => {
  const { dialog } = await openAddDialogue(page, request, undefined, { tags: ['Annual'] })
  await dialog.getByRole('combobox', { name: 'Account' }).click()
  await dialog.getByRole('option', { name: 'Everyday Chequing', exact: true }).click()

  // Unfiltered, Annual leads the list and is the highlighted option
  await page.keyboard.press('Alt+KeyG')
  await expect(dialog.getByPlaceholder('Search tags...')).toBeFocused()
  await expect(dialog.getByRole('option', { name: 'Annual', exact: true })).toBeVisible()

  // Enter lands within the search's debounce, while the list still holds every tag
  await page.keyboard.type('Holi')
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('option', { name: 'Holiday', exact: true })).toBeVisible()
  await expect(dialog.getByRole('option')).toHaveCount(1)
  await expect(dialog.getByRole('button', { name: /^Remove / })).toHaveCount(0)

  // Once the results match what was typed, Enter adds that tag
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('button', { name: 'Remove Holiday' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /^Remove / })).toHaveCount(1)
})

test('chooses no merchant from an Enter pressed before the Merchant search has narrowed', async ({ page, request }) => {
  const { dialog } = await openAddDialogue(page, request, undefined, { merchants: ['Alpha Shop', 'Bakery'] })
  const merchant = dialog.getByRole('combobox', { name: 'Merchant' })
  const unchosen = await merchant.innerText()

  await page.keyboard.press('Alt+KeyM')
  await expect(dialog.getByPlaceholder('Search merchants...')).toBeFocused()
  await expect(dialog.getByRole('option', { name: 'Alpha Shop', exact: true })).toBeVisible()
  await page.keyboard.type('Bak')
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('option')).toHaveCount(1)
  await expect(merchant).toHaveText(unchosen)

  await page.keyboard.press('Enter')
  await expect(merchant).toContainText('Bakery')
})

test('takes one action from a chord that is held down, and one save from a held Alt+Enter', async ({
  page,
  request,
}) => {
  const { dialog } = await openAddDialogue(page, request)
  const type = dialog.getByRole('tablist', { name: 'Transaction type' })
  const direction = dialog.getByRole('tablist', { name: 'Transaction direction' })
  const submit = dialog.getByTestId('transaction-submit')
  await submit.evaluate((button) => {
    const clicks = { count: 0 }
    Object.assign(window, { submitClicks: clicks })
    button.addEventListener('click', () => (clicks.count += 1))
  })

  // A key held down repeats its keydown, which Playwright sends when the key is pressed again unreleased
  const hold = async (key: string) => {
    await page.keyboard.down(key)
    await page.keyboard.down(key)
    await page.keyboard.down(key)
    await page.keyboard.up(key)
  }

  await page.keyboard.down('Alt')
  await hold('KeyY')
  await hold('KeyR')
  await expect(type.getByRole('tab', { name: 'Income' })).toHaveAttribute('aria-selected', 'true')
  await expect(direction.getByRole('tab', { name: 'Credit' })).toHaveAttribute('aria-selected', 'true')

  // The list opened by the first press stays open instead of collapsing and opening again
  await hold('KeyA')
  await expect(dialog.getByRole('combobox', { name: 'Account' })).toHaveAttribute('aria-expanded', 'true')

  await hold('Enter')
  expect(await page.evaluate(() => (window as unknown as { submitClicks: { count: number } }).submitClicks.count)).toBe(1)
  await page.keyboard.up('Alt')
})

test('leaves a partly typed date alone when [ or ] is pressed', async ({ page, request }) => {
  const { dialog } = await openAddDialogue(page, request)

  // Erasing the day leaves a date begun but not whole
  await dialog.getByRole('group', { name: 'Date', exact: true }).getByRole('textbox', { name: 'Day', exact: true }).focus()
  await page.keyboard.press('Backspace')
  const partial = await readDateOnce(dialog)
  expect(partial).toMatch(/^\d{4}-\d{2}-$/)

  await page.keyboard.press('BracketLeft')
  await page.keyboard.press('BracketRight')
  expect(await readDate(dialog)).toBe(partial)

  // A whole date steps again
  await page.keyboard.type('15')
  expect(await readDate(dialog)).toBe(`${partial}15`)
  await page.keyboard.press('BracketRight')
  expect(await readDate(dialog)).toBe(
    `${partial}16`,
  )
})
