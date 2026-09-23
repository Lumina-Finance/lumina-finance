import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

test('shows a renamed tag without reloading when its id and list position stay the same', async ({ page, request }) => {
  const user = await signUpUser(request)
  const headers = { Authorization: `Bearer ${user.accessToken}` }
  const prefix = `Rename ${crypto.randomUUID()}`
  const oldName = `${prefix} old`
  const newName = `${prefix} new`
  const created = await request.post(`${API_BASE_URL}/tags`, { headers, data: { name: oldName } })
  expect(created.status()).toBe(201)
  const { id } = await created.json() as { id: string }

  await logInViaApi(page, user)
  await openPage(page, '/settings#tags')
  const tags = page.locator('#tags')
  const searched = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/api/tags' &&
      url.searchParams.get('q') === prefix &&
      response.request().method() === 'GET'
  })
  await tags.getByPlaceholder('Search tags...').fill(prefix)
  expect((await searched).status()).toBe(200)
  await expect(tags.getByRole('status', { name: 'Loading tags' })).toHaveCount(0)
  await expect(tags.getByRole('button', { name: `Edit ${oldName}`, exact: true })).toBeVisible()

  await tags.getByRole('button', { name: `Edit ${oldName}`, exact: true }).click()
  await tags.getByRole('textbox', { name: `${oldName} name`, exact: true }).fill(newName)
  const saved = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/tags/${id}` && response.request().method() === 'PATCH')
  await tags.getByRole('button', { name: `Save ${oldName}`, exact: true }).click()
  expect((await saved).status()).toBe(200)

  await expect(tags.getByRole('cell', { name: `${newName} Personal`, exact: true })).toBeVisible()
  await expect(tags.getByRole('button', { name: `Edit ${newName}`, exact: true })).toBeVisible()
  await expect(tags.getByRole('button', { name: `Delete ${newName}`, exact: true })).toBeVisible()
  await expect(tags.getByRole('cell', { name: `${oldName} Personal`, exact: true })).toHaveCount(0)

  const persisted = await request.get(`${API_BASE_URL}/tags/${id}`, { headers })
  expect(persisted.status()).toBe(200)
  expect(await persisted.json()).toMatchObject({ id, name: newName })
})
