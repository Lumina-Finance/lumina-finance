import { expect, test } from '@playwright/test'

import { asUser, createAccount, createInstitution, signUpUser } from '../support/api'
import { openPage, logInViaApi, openModal } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs at desktop only: paging and search act the same at every width, and the picker's own layout
// is covered by the specs that open it

const FILLER_COUNT = 55

test('the institution picker pages at fifty, searches by name and names a selection beyond the first page', async ({ page, request }) => {
  const user = await signUpUser(request)
  const run = crypto.randomUUID().slice(0, 8)

  // Every user's institutions share one table, so the filler names sort ahead of the account's own
  // and push it past the first page whatever else other runs left in the table
  for (let index = 0; index < FILLER_COUNT; index++) {
    await createInstitution(request, user, `AAA paged ${run} ${String(index).padStart(2, '0')}`)
  }
  const lastName = `ZZZ paged ${run} last`
  const lastId = await createInstitution(request, user, lastName)
  const account = await createAccount(request, user, { name: 'Institution paging account' })
  const linked = await request.patch(`${API_BASE_URL}/accounts/${account.id}`, {
    headers: asUser(user), data: { institution_id: lastId },
  })
  expect(linked.status()).toBe(200)

  // The whole table is never asked for: every list request carries its page size
  const listPath = new URL(`${API_BASE_URL}/institutions`).pathname
  const listRequests: string[] = []
  page.on('request', (seen) => {
    const url = new URL(seen.url())
    if (seen.method() === 'GET' && url.pathname === listPath) listRequests.push(url.search)
  })

  await logInViaApi(page, user)
  await openPage(page, '/accounts')
  const create = await openModal(page, ['Add account'], 'Add account')
  const picker = create.getByRole('combobox', { name: 'Institution', exact: true })
  await picker.click()

  // The first fifty institutions appear, with None ahead of them
  const options = create.getByRole('listbox').getByRole('option')
  await expect(options).toHaveCount(51)
  await expect(options.first()).toHaveText('None')

  // Scrolling to the end of the list reads the next page
  await create.getByRole('listbox').evaluate((list) => { list.scrollTop = list.scrollHeight })
  await expect.poll(() => options.count()).toBeGreaterThan(51)
  expect(listRequests.some((query) => new URLSearchParams(query).get('offset') === '50')).toBe(true)

  // Typing filters by name on the server, and reaches an institution far past the first page
  const search = create.getByPlaceholder('Search institutions...', { exact: true })
  await search.fill(`AAA paged ${run} 07`)
  await expect(options).toHaveCount(1)
  await expect(options.first()).toHaveText(`AAA paged ${run} 07`)
  await search.fill(lastName)

  // The name is checked before the click, since the previous search's one match is on screen until this one lands
  await expect(options.first()).toHaveText(lastName)
  await expect(options).toHaveCount(1)
  await options.first().click()
  await expect(picker).toHaveText(lastName)
  await create.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(create).toBeHidden()

  // An account whose institution is not on the first page still shows its name
  await openPage(page, `/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await expect(edit.getByRole('combobox', { name: 'Institution', exact: true })).toHaveText(lastName)

  expect(listRequests.length).toBeGreaterThan(0)
  for (const search of listRequests) expect(new URLSearchParams(search).get('limit')).toBe('50')
})
