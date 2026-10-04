import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser, startOfDayInTestTimezone } from '../support/api'
import { openPage, chooseFromDropdown, filterByCategory, logInViaApi, openModal } from '../support/app'
import { expectPendingAction, expectTransactionRow, whileApiRequestHeld } from '../support/selectors'

test('filters the list down to one category', async ({ page, request }) => {
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
  return { upcomingId, upcoming: page.getByRole('button', { name: /Upcoming/ }) }
}

test('keeps future-dated transactions in a collapsed Upcoming section until it is opened', async ({ page, request }) => {
  const { upcomingId, upcoming } = await openListWithUpcomingAndToday(page, request)
  await expect(upcoming).toHaveAttribute('aria-expanded', 'false')
  await expect(upcoming).toHaveText(/^Upcoming1\D/)
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

test('keeps the open Upcoming header on screen through a long run of upcoming transactions', async ({ page, request }) => {
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
  // only once the end has been reached for every page
  await expect(async () => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(page.getByTestId(`transaction-row-${pastIds[pastIds.length - 1]}`)).toBeAttached({ timeout: 1000 })
  }).toPass()
  const upcoming = page.getByRole('button', { name: /Upcoming/ })
  await upcoming.click()

  // Into the middle of the run, with upcoming rows filling the window and no past row on it. The browser's own
  // scroll anchoring holds a past row in place as the section closes, which would bring the header back
  // without the section's help. Retried while the section is still growing open, which moves the rows
  await expect(async () => {
    await page.getByTestId(`transaction-row-${ids[8]}`).evaluate((row) => row.scrollIntoView({ block: 'start' }))
    await expect(page.getByTestId(`transaction-row-${pastIds[0]}`)).not.toBeInViewport({ timeout: 500 })
    // The section's first row has left the screen, so its header is only showing because it sticks
    await expect(page.getByTestId(`transaction-row-${ids[0]}`)).not.toBeInViewport({ timeout: 500 })
  }).toPass()
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

  // A minute before tomorrow begins, so the day turns over with the page still open
  await logInViaApi(page, user)
  await page.clock.install({ time: startOfDayInTestTimezone(tomorrow).getTime() - 60_000 })
  await openPage(page, '/transactions')

  // With only an upcoming transaction loaded, the list is not empty
  const upcoming = page.getByRole('button', { name: /Upcoming/ })
  await expect(upcoming).toHaveText(/^Upcoming1\D/)
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

    await expect(page.getByRole('button', { name: /Upcoming/ })).toHaveText(/^Upcoming1\D/)
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
