import { expect, test } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { openPage, logIn, openModal } from '../support/app'
import { API_BASE_URL } from '../support/target'

test('corrects the highlighted institution by keyboard and the original inline action', async ({ page, request }) => {
  const user = await signUpUser(request)
  const headers = { Authorization: `Bearer ${user.accessToken}` }
  const name = `E2E correction bank ${crypto.randomUUID()}`
  const created = await request.post(`${API_BASE_URL}/institutions`, {
    headers, data: { name, country_code: 'CA', website: 'https://example.com' },
  })
  expect(created.status()).toBe(201)
  const institution = await created.json() as { id: string }
  const account = await createAccount(request, user, { name: 'Institution correction account' })
  const linked = await request.patch(`${API_BASE_URL}/accounts/${account.id}`, {
    headers, data: { institution_id: institution.id },
  })
  expect(linked.status()).toBe(200)

  await logIn(page, user)
  await openPage(page, '/accounts')
  const create = await openModal(page, ['Add Account', 'Add account'], 'Add Account')
  const picker = create.getByRole('combobox', { name: 'Institution', exact: true })
  const describedBy = await picker.getAttribute('aria-describedby')
  expect(describedBy).toBeTruthy()
  await picker.press('Alt+Enter')
  const correction = page.getByRole('dialog', { name: 'Correct Institution', exact: true })
  await expect(correction).toBeHidden()
  await expect(picker).toHaveAttribute('aria-expanded', 'false')

  await picker.click()
  const search = create.getByPlaceholder('Search institutions...', { exact: true })
  await expect(search).toHaveAttribute('aria-describedby', describedBy!)
  await expect(create.locator(`[id="${describedBy}"]`)).toHaveText(
    'Press Alt+Enter to edit the highlighted option.',
  )

  await search.fill(name)
  const target = create.getByRole('option', { name, exact: true })
  await expect(target).toBeVisible()
  await expect(create.getByRole('listbox').getByRole('button')).toHaveCount(0)

  await search.press('Shift+Alt+Enter')
  await expect(correction).toBeHidden()
  await expect(picker).toHaveText('None')
  await expect(picker).toHaveAttribute('aria-expanded', 'true')

  await search.press('Alt+Enter')
  await expect(correction.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(name)
  await expect(picker).toHaveAttribute('aria-expanded', 'false')
  await correction.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(correction).toBeHidden()
  await expect(picker).toHaveText('None')

  await picker.click()
  await search.fill('None')
  await expect(create.getByRole('option', { name: 'None', exact: true })).toBeVisible()
  await search.press('Alt+Enter')
  await expect(correction).toBeHidden()
  await expect(picker).toHaveAttribute('aria-expanded', 'true')
  await search.press('Escape')
  await create.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(create).toBeHidden()

  await openPage(page, `/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Edit Account', exact: true })
  const current = edit.getByRole('combobox', { name: 'Institution', exact: true })
  await expect(current).toHaveText(name)
  await current.click()
  const editSearch = edit.getByPlaceholder('Search institutions...', { exact: true })
  await editSearch.fill(name)
  const currentOption = edit.getByRole('option', { name, exact: true })
  const inlineEdit = currentOption.locator('.app-dropdown-row-edit')
  await expect(inlineEdit).toHaveAttribute('title', 'Correct institution (Alt+Enter)')
  await expect(currentOption.getByRole('button')).toHaveCount(0)
  await expect(inlineEdit).toBeInViewport()
  if (test.info().project.name === 'desktop') {
    await currentOption.hover()
    await inlineEdit.click()
  } else {
    await inlineEdit.tap()
  }
  await expect(correction.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(name)
  await correction.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(correction).toBeHidden()
  await expect(current).toHaveText(name)
})
