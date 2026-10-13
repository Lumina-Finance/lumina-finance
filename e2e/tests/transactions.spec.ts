import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser, startOfDayInTestTimezone } from '../support/api'
import { openPage, chooseFromDropdown, filterByCategory, logInViaApi, openModal } from '../support/app'
import { expectPendingAction, expectTransactionRow, whileApiRequestHeld } from '../support/selectors'
import { AT_EVERY_SIZE } from '../support/sizes'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only, apart from the category filter and Upcoming header tests, which run at
// every size: filters show as a sheet on a phone, and the header pins differently by layout. The
// row layout test resizes the desktop window itself, to widths no project has

test('filters the list down to one category', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })

  const ids: string[] = []
  for (const seed of [
    { categoryName: 'Groceries', amount: -1000 },
    { categoryName: 'Groceries', amount: -2000 },
    { categoryName: 'Dining', amount: -3000 },
  ]) {
    ids.push(await createTransaction(request, user, { accountId: account.id, ...seed }))
  }

  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const groceries = ids.slice(0, 2).map((id) => page.getByTestId(`transaction-row-${id}`))
  const dining = page.getByTestId(`transaction-row-${ids[2]}`)
  const rows = page.getByTestId(/^transaction-row-/)
  await expect(rows).toHaveCount(3)
  for (const [index, amount] of ['-$10.00', '-$20.00', '-$30.00'].entries()) {
    await expectTransactionRow(page, ids[index], amount)
  }

  await filterByCategory(page, 'Groceries')

  // The list holds the rows it had before Apply for a second, so anything asserted first would
  // be reading the unfiltered list. Waiting for the Dining row to go is what says the filtered
  // result has arrived, and only then does what survived mean anything
  await expect(dining).toBeHidden()

  // Counted as well as named, or a filter that wrongly matched nothing would leave an empty
  // list that satisfies every assertion about what should have gone
  await expect(rows).toHaveCount(2)
  for (const row of groceries) {
    await expect(row).toBeVisible()
  }

  // Nothing here asserts on the filter controls themselves. A collapsed panel keeps its
  // children in the DOM without inert or aria-hidden, so a check that the Groceries box is
  // visible passes whether or not the panel ever opened
})

/** Opens the transactions page for a new user with one transaction three days ahead and one today */
async function openListWithUpcomingAndToday(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })
  const upcomingId = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4500,
    date: daysFromTodayInTestTimezone(3),
  })
  const todayId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000 })

  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  // Today's row settles the list first, so anything read about the upcoming row is read from a loaded list
  await expectTransactionRow(page, todayId, '-$10.00')
  return { upcomingId, todayId, upcoming: page.getByRole('button', { name: /Upcoming/ }) }
}

test('keeps future-dated transactions in a collapsed Upcoming section until it is opened', async ({ page, request }) => {
  const { upcomingId, upcoming } = await openListWithUpcomingAndToday(page, request)
  await expect(upcoming).toHaveAttribute('aria-expanded', 'false')
  await expect(upcoming).toHaveAccessibleName(/^Upcoming\s*1\D/)
  await expect(page.getByText("These haven't happened yet")).toHaveCount(0)
  await expect(page.getByTestId(`transaction-row-${upcomingId}`)).toHaveCount(0)

  await upcoming.click()
  await expect(upcoming).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText("These haven't happened yet")).toBeVisible()
  await expectTransactionRow(page, upcomingId, '-$45.00')
})

test('closes the Upcoming section again when a search empties it and it comes back', async ({ page, request }) => {
  const { upcomingId, upcoming } = await openListWithUpcomingAndToday(page, request)
  await upcoming.click()
  await expectTransactionRow(page, upcomingId, '-$45.00')

  const search = page.getByPlaceholder('Search transactions...', { exact: true })
  await search.fill('no transaction matches this')
  await expect(upcoming).toHaveCount(0)
  await search.fill('')
  await expect(upcoming).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId(`transaction-row-${upcomingId}`)).toHaveCount(0)
})

test('unticks upcoming transactions when the Upcoming section closes', async ({ page, request }) => {
  const { upcomingId, upcoming } = await openListWithUpcomingAndToday(page, request)
  await upcoming.click()
  await expectTransactionRow(page, upcomingId, '-$45.00')

  // Closing the section unticks what it hides, so an edit never reaches rows the user can't see
  await page.getByRole('button', { name: 'Select transactions', exact: true }).click()
  const days = page.getByRole('checkbox', { name: /^Select the transactions shown on / })
  await expect(days).toHaveCount(2)
  for (const day of await days.all()) await day.check()
  await upcoming.click()
  await expect(upcoming).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: 'Edit the selected transactions', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Edit 1 transaction', exact: true })).toBeVisible()
})

test('shows a hover on an upcoming row in the light theme', async ({ page, request }) => {
  // Reduced motion opens the section at once, so the rows have stopped moving when their colours are read
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  const { upcomingId, todayId, upcoming } = await openListWithUpcomingAndToday(page, request)
  await upcoming.click()
  await expectTransactionRow(page, upcomingId, '-$45.00')

  // A hovered upcoming row stands out from the section's shading at least as much as a hovered row in the
  // main list stands out from the page
  const mainListChange = await hoverChange(page, page.getByTestId(`transaction-row-${todayId}`))
  expect(mainListChange).toBeGreaterThan(0)
  expect(await hoverChange(page, page.getByTestId(`transaction-row-${upcomingId}`))).toBeGreaterThanOrEqual(mainListChange)
})

/**
 * Returns how far the colour drawn at the top edge of a row's background moves once the pointer is on the row,
 * as the sum of the change in each colour channel. The point sits in the row's own padding, above its text
 */
async function hoverChange(page: Page, rowButton: Locator): Promise<number> {
  // The background belongs to the row around the button, which also holds the checkbox in selection
  const point = await rowButton.evaluate((button) => {
    const rect = button.parentElement!.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + 3 }
  })
  await page.mouse.move(0, 0)
  const before = await colourAt(page, point.x, point.y)
  await page.mouse.move(point.x, point.y)
  // The hover fades in, so the colour is read once the row is hovered and its fade has ended
  await expect.poll(() => rowButton.evaluate(({ parentElement: row }) => row!.matches(':hover') && row!.getAnimations().length === 0)).toBe(true)
  const after = await colourAt(page, point.x, point.y)
  await page.mouse.move(0, 0)
  return after.reduce((sum, channel, index) => sum + Math.abs(channel - before[index]), 0)
}

/** Reads the colour the page draws at a point, as its red, green and blue channels */
async function colourAt(page: Page, x: number, y: number): Promise<number[]> {
  const shot = await page.screenshot({ clip: { x, y, width: 1, height: 1 } })
  return page.evaluate(async (data) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]
  }, shot.toString('base64'))
}

test('keeps the open Upcoming header on screen through a long run of upcoming transactions', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })
  const ids: string[] = []
  for (let day = 20; day >= 1; day -= 1) {
    ids.push(await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date: daysFromTodayInTestTimezone(day) }))
  }
  // Past rows below the section keep the page taller than the window once it closes, so the browser
  // can't bring the header back into view on its own by running out of page
  const pastIds: string[] = []
  for (let day = 0; day >= -14; day -= 1) {
    pastIds.push(await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date: daysFromTodayInTestTimezone(day) }))
  }

  // A short window, so the twenty run past it at every width
  await page.setViewportSize({ ...page.viewportSize()!, height: 600 })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  // The list loads fifteen at a time, a page each time the end comes into view, so the oldest past row arrives
  // only once the end has been reached for every page. Each scroll waits for the page before it to land, and
  // the list may load the next one on its own while its end is still in view
  const loadingMore = page.getByText(/^Loading more transactions/)
  const reachedEnd = page.getByText("You've reached the end.")
  await expect(loadingMore).toBeHidden()
  // One scroll per page: each waits for that page to start and finish loading before the next
  while (!(await reachedEnd.isVisible())) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(loadingMore.or(reachedEnd)).toBeVisible()
    await expect(loadingMore).toBeHidden()
  }
  await expect(page.getByTestId(`transaction-row-${pastIds[pastIds.length - 1]}`)).toBeAttached()
  const upcoming = page.getByRole('button', { name: /Upcoming/ })
  await upcoming.click()

  // The section's body fades in fully as it finishes growing open, then stops clipping its overflow, so the
  // rows have stopped moving. Its overflow alone reads visible for a moment before the opening starts
  const body = page.locator(`[id="${await upcoming.getAttribute('aria-controls')}"]`)
  await expect(body).toHaveCSS('opacity', '1')
  await expect(body).toHaveCSS('overflow', 'visible')
  const firstUpcomingRow = page.getByTestId(`transaction-row-${ids[0]}`)

  // Into the middle of the run, with upcoming rows filling the window and no past row on it. The browser's own
  // scroll anchoring holds a past row in place as the section closes, which would bring the header back
  // without the section's help
  await page.getByTestId(`transaction-row-${ids[8]}`).evaluate((row) => row.scrollIntoView({ block: 'start' }))
  await expect(page.getByTestId(`transaction-row-${pastIds[0]}`)).not.toBeInViewport()
  // The section's first row has left the screen, so its header is only showing because it sticks
  await expect(firstUpcomingRow).not.toBeInViewport()
  await expect.poll(() => isShowingOnTop(upcoming)).toBe(true)

  // Clicked where it shows on screen, so nothing but the section moves the page before the click
  const header = (await upcoming.boundingBox())!
  await page.mouse.click(header.x + header.width / 2, header.y + header.height / 2)
  await expect(upcoming).toHaveAttribute('aria-expanded', 'false')

  // The rows leave once the closing animation ends, so the check reads where the header settles rather than a
  // frame on the way, when it is still stuck in view
  await expect(page.getByTestId(`transaction-row-${ids[8]}`)).toHaveCount(0)
  // Closing from deep inside the section brings the page back to its header, rather than leaving it above
  // the screen or under the toolbar
  expect(await isShowingOnTop(upcoming)).toBe(true)
})

/**
 * Returns whether the element is what the page shows at its own centre, so one scrolled off the screen or
 * covered by the sticky toolbar both count as not showing
 */
async function isShowingOnTop(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const shown = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return shown !== null && element.contains(shown)
  })
}

test('loads the next page when the browser reports the end of the list leaving and coming back at once', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })
  // One more than the fifteen a page holds, so the oldest arrives only with the second page
  const ids: string[] = []
  for (let day = 0; day >= -15; day -= 1) {
    ids.push(await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date: daysFromTodayInTestTimezone(day) }))
  }

  // A busy page hands several changes to an observer in one call, oldest first. This holds back the
  // changes to the end of the list until the test lets them through together, so the call is the same
  // on every run, and passes every other observer's on as they come
  await page.addInitScript(() => {
    const pending: (() => void)[] = []
    const NativeObserver = window.IntersectionObserver
    window.IntersectionObserver = class extends NativeObserver {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        let held: IntersectionObserverEntry[] = []
        super((entries, observer) => {
          const listEnd = entries.filter((entry) => (entry.target as HTMLElement).dataset.testid === 'transaction-list-end')
          const others = entries.filter((entry) => !listEnd.includes(entry))
          if (others.length > 0) callback(others, observer)
          if (listEnd.length === 0) return
          if (held.length === 0) pending.push(release)
          held.push(...listEnd)
        }, options)
        const release = () => {
          const batch = held
          held = []
          if (batch.length > 0) callback(batch, this)
        }
        // The hook replaces its observer whenever its inputs change, so only a live observer's changes stay held
        const disconnect = this.disconnect.bind(this)
        this.disconnect = () => {
          held = []
          if (pending.includes(release)) pending.splice(pending.indexOf(release), 1)
          disconnect()
        }
      }
    }
    Object.assign(window, {
      heldIntersections: () => pending.length,
      releaseIntersections: () => pending.splice(0).forEach((release) => release()),
    })
  })
  await page.setViewportSize({ ...page.viewportSize()!, height: 600 })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expectTransactionRow(page, ids[0], '-$10.00')

  // The end of the first page starts out of view, which the observer reports as soon as it watches it
  await expect.poll(() => page.evaluate(() => (window as unknown as { heldIntersections: () => number }).heldIntersections())).toBe(1)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.evaluate(() => (window as unknown as { releaseIntersections: () => void }).releaseIntersections())
  await expect(page.getByTestId(`transaction-row-${ids[ids.length - 1]}`)).toBeAttached()
})

test('moves an upcoming transaction into the list when its day comes while the page is open', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })
  const tomorrow = daysFromTodayInTestTimezone(1)
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4500,
    date: tomorrow,
  })

  // A minute before tomorrow begins, so the day turns over with the page still open. Motion is reduced
  // because the fake clock holds the browser's own fades, which would keep the emptied section on screen
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await logInViaApi(page, user)
  await page.clock.install({ time: startOfDayInTestTimezone(tomorrow).getTime() - 60_000 })
  await openPage(page, '/transactions')

  // With only an upcoming transaction loaded, the list is not empty
  const upcoming = page.getByRole('button', { name: /Upcoming/ })
  await expect(upcoming).toHaveAccessibleName(/^Upcoming\s*1\D/)
  await expect(page.getByText('No transactions yet.')).toHaveCount(0)
  await expect(page.getByTestId(`transaction-row-${id}`)).toHaveCount(0)

  // Past midnight and the next check of the day
  await page.clock.fastForward('02:00')
  await expectTransactionRow(page, id, '-$45.00')
  await expect(upcoming).toHaveCount(0)
})

test.describe('with the browser in Tokyo and the profile in Toronto', () => {
  test.use({ timezoneId: 'Asia/Tokyo' })

  test('keeps a transaction dated tomorrow in the profile timezone upcoming once the browser has reached that day', async ({ page, request }) => {
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday Chequing' })
    const tomorrow = daysFromTodayInTestTimezone(1)
    const id = await createTransaction(request, user, {
      accountId: account.id,
      categoryName: 'Groceries',
      amount: -4500,
      date: tomorrow,
    })

    // An hour before tomorrow begins in Toronto, when it is already tomorrow afternoon in Tokyo
    await logInViaApi(page, user)
    await page.clock.install({ time: startOfDayInTestTimezone(tomorrow).getTime() - 3_600_000 })
    await openPage(page, '/transactions')

    await expect(page.getByRole('button', { name: /Upcoming/ })).toHaveAccessibleName(/^Upcoming\s*1\D/)
    await expect(page.getByTestId(`transaction-row-${id}`)).toHaveCount(0)
  })
})

test('keeps transaction account controls identifiable as transfer labels change', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Transfer source' })
  await createAccount(request, user, { name: 'Transfer destination' })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const dialog = await openModal(page, ['Add Transaction', 'Add transaction'], 'Add Transaction')
  const account = dialog.getByTestId('transaction-account')
  const counterparty = dialog.getByTestId('transaction-counterparty-account')

  await expect(account).toHaveRole('combobox')
  await expect(account).toHaveAccessibleName('Account')
  await expect(counterparty).toHaveCount(0)
  await dialog.getByRole('tab', { name: 'Transfer', exact: true }).click()
  await chooseFromDropdown(dialog, 'Category', 'Transfer')
  await expect(account).toHaveAccessibleName('Recorded in')
  await expect(counterparty).toHaveRole('combobox')
  await expect(counterparty).toHaveAccessibleName('Money went to')
  await dialog.getByRole('tab', { name: 'Credit', exact: true }).click()
  await expect(counterparty).toHaveAccessibleName('Money came from')
  await dialog.getByRole('checkbox', { name: /Record in both accounts/ }).check()
  await expect(account).toHaveAccessibleName('From account')
  await expect(counterparty).toHaveAccessibleName('Money went to')
  await dialog.getByRole('checkbox', { name: /Record in both accounts/ }).uncheck()
  await chooseFromDropdown(dialog, 'Category', 'Balance Adjustment')
  await expect(account).toHaveAccessibleName('Account')
  await expect(counterparty).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('preserves transaction action names through save and delete confirmation', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Action account' })
  const id = await createTransaction(request, user, {
    accountId: account.id, categoryName: 'Groceries', amount: -4250,
  })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expectTransactionRow(page, id, '-$42.50')
  await page.getByTestId(`transaction-row-${id}`).click()
  const dialog = page.getByRole('dialog', { name: 'Edit Transaction', exact: true })
  await dialog.getByLabel('Amount').fill('43.50')
  const submit = dialog.getByTestId('transaction-submit')
  await expect(submit).toHaveRole('button')
  await expect(submit).toHaveAccessibleName('Save')
  await whileApiRequestHeld(page, 'PATCH', `/transactions/${id}`,
    () => submit.click(), () => expectPendingAction(submit, 'Save'))
  await expect(dialog).toBeHidden()
  await expectTransactionRow(page, id, '-$43.50')

  await page.getByTestId(`transaction-row-${id}`).click()
  const remove = dialog.getByTestId('transaction-delete')
  await expect(remove).toHaveRole('button')
  await expect(remove).toHaveAccessibleName('Delete')
  await remove.click()
  await expect(remove).toHaveAccessibleName('Yes, delete')
  await dialog.getByLabel('Amount').click()
  await expect(remove).toHaveAccessibleName('Delete')
  await remove.click()
  await expect(remove).toHaveAccessibleName('Yes, delete')
  await whileApiRequestHeld(page, 'DELETE', `/transactions/${id}`,
    () => remove.click(), () => expectPendingAction(remove, 'Yes, delete'))
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId(`transaction-row-${id}`)).toBeHidden()
})

test('leaves the date in Add Transaction with one Tab, past its calendar icon', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const dialog = await openModal(page, ['Add Transaction', 'Add transaction'], 'Add Transaction')
  const date = dialog.getByRole('group', { name: 'Date', exact: true })
  const day = date.getByRole('textbox', { name: 'Day', exact: true })

  await day.click()
  await day.press('Control+a')
  await page.keyboard.type('5')
  await page.keyboard.press('Tab')
  // The calendar icon is out of the Tab order, so one press leaves the field, and leaving it tidies the day
  await expect(dialog.getByRole('button', { name: 'Open calendar', exact: true })).not.toBeFocused()
  await expect.poll(() => date.evaluate((group) => group.contains(document.activeElement))).toBe(false)
  await expect(day).toHaveValue('05')

  await page.keyboard.press('Shift+Tab')
  await expect(day).toBeFocused()
})

/**
 * Signs up a user with a plain row and a row carrying the note "Weekly shop" and two tags in
 * "Everyday Chequing", and opens the Transactions page with the noted row's note found as text and
 * as an icon
 */
async function openNotedRow(page: Page, request: APIRequestContext) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })
  const tagIds: string[] = []
  for (const name of ['Family', 'Reviewed']) {
    const response = await request.post(`${API_BASE_URL}/tags`, { headers: asUser(user), data: { name } })
    expect(response.status()).toBe(201)
    tagIds.push((await response.json() as { id: string }).id)
  }
  const notedId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, notes: 'Weekly shop', tagIds })
  const plainId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -2000 })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expectTransactionRow(page, plainId, '-$20.00')
  const noted = page.getByTestId(`transaction-row-${notedId}`)
  return {
    user,
    noted,
    plain: page.getByTestId(`transaction-row-${plainId}`),
    noteText: noted.getByText('Weekly shop', { exact: true }).filter({ visible: true }),
    noteIcon: noted.getByLabel('Has note', { exact: true }).filter({ visible: true }),
  }
}

test('shows a note as text in its own column, centred in the row, from 750px wide', async ({ page, request }) => {
  const { noted, plain, noteText, noteIcon } = await openNotedRow(page, request)

  // One pixel either side of the layout switch, and widths above it. Soft, so a failing run names
  // every width
  const softly = expect.configure({ soft: true })
  for (const [width, shows] of [[749, 'icon'], [750, 'text'], [1024, 'text'], [1920, 'text']] as const) {
    await page.setViewportSize({ ...page.viewportSize()!, width })
    await softly(noteText, `${width}px`).toHaveCount(shows === 'text' ? 1 : 0)
    await softly(noteIcon, `${width}px`).toHaveCount(shows === 'icon' ? 1 : 0)
    if (shows === 'text') {
      // The note has a column of its own, centred in the row, so a noted row is no taller than one without
      const plainHeight = (await plain.boundingBox())!.height
      await softly.poll(async () => (await noted.boundingBox())!.height, { message: `${width}px` }).toBe(plainHeight)
      const row = (await noted.boundingBox())!
      const note = (await noteText.boundingBox())!
      softly(Math.abs(note.y + note.height / 2 - (row.y + row.height / 2)), `${width}px centred`).toBeLessThan(2)
    }
  }
})

test('keeps the letters that hang below the line whole in a note and an account name', async ({ page, request }) => {
  const { noted, noteText } = await openNotedRow(page, request)

  // A truncating line clips what it can't hold, so it must be tall enough for the "g" and "q"
  const softly = expect.configure({ soft: true })
  for (const width of [750, 1920]) {
    await page.setViewportSize({ ...page.viewportSize()!, width })
    for (const text of [noteText, noted.getByText('Everyday Chequing', { exact: true }).filter({ visible: true })]) {
      softly(await text.evaluate((element) => element.scrollHeight <= element.clientHeight), `${width}px descenders`).toBe(true)
    }
  }
})

test('gives the category, merchant and account room first, then the note, then the tag names, from 750px wide', async ({ page, request }) => {
  const { user, noted, noteText, noteIcon } = await openNotedRow(page, request)

  // With short names a narrow row gives up the tag names before the note, and a wide one shows both.
  // Counted as drawn, since the hover list repeats the names, transparent until it opens
  const softly = expect.configure({ soft: true })
  const tagNamesDrawn = () => noted.getByText('Family', { exact: true }).filter({ visible: true })
    .evaluateAll((names) => names.filter((name) => getComputedStyle(name.parentElement!).opacity !== '0').length)
  const tagCount = noted.getByLabel('2 tags', { exact: true }).filter({ visible: true })
  for (const [width, tags] of [[750, 'icon'], [1920, 'names']] as const) {
    await page.setViewportSize({ ...page.viewportSize()!, width })
    await softly.poll(tagNamesDrawn, { message: `${width}px tag names` }).toBe(tags === 'names' ? 1 : 0)
    await softly(tagCount, `${width}px tag count`).toHaveCount(tags === 'icon' ? 1 : 0)
    await softly(noteText, `${width}px note`).toHaveCount(1)
  }

  // Long merchant and account names keep their room, so a narrow list turns every note to its icon,
  // the short one too, while a wide one still has room for the text
  const merchantName = 'Pacific Northwest Organic Grocers'
  const accountName = 'Joint Household Chequing'
  expect((await request.post(`${API_BASE_URL}/merchants`, { headers: asUser(user), data: { name: merchantName } })).status()).toBe(201)
  const longAccount = await createAccount(request, user, { name: accountName })
  const longId = await createTransaction(request, user, { accountId: longAccount.id, categoryName: 'Groceries', amount: -3000, notes: 'Cottage trip', merchantName })
  const long = page.getByTestId(`transaction-row-${longId}`)
  const shown = (text: string) => long.getByText(text, { exact: true }).filter({ visible: true })
  await page.reload()
  for (const [width, note] of [[750, 'icon'], [1920, 'text']] as const) {
    await page.setViewportSize({ ...page.viewportSize()!, width })
    await expect(shown(merchantName), `${width}px`).toBeVisible()
    for (const name of [merchantName, accountName]) {
      softly(await shown(name).evaluate((element) => element.scrollWidth <= element.clientWidth), `${width}px ${name} whole`).toBe(true)
    }
    await softly(noteText, `${width}px short note`).toHaveCount(note === 'text' ? 1 : 0)
    await softly(noteIcon, `${width}px short note icon`).toHaveCount(note === 'icon' ? 1 : 0)
    softly(await long.evaluate((row) => row.scrollWidth <= row.clientWidth), `${width}px the row fits`).toBe(true)
  }
})
