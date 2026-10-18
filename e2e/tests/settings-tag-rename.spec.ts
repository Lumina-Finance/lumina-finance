import { expect, test } from '@playwright/test'

import { asUser, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: renaming a tag gives the same result at every size

test('shows a renamed tag without reloading when its id and list position stay the same', async ({ page, request }) => {
  const user = await signUpUser(request)
  const headers = asUser(user)
  const prefix = `Rename ${crypto.randomUUID()}`
  const oldName = `${prefix} old`
  const newName = `${prefix} new`
  const created = await request.post(`${API_BASE_URL}/tags`, { headers, data: { name: oldName } })
  expect(created.status()).toBe(201)
  const { id } = await created.json() as { id: string }

  await logInViaApi(page, user)
  await openPage(page, '/settings#tags')
  const tags = page.locator('#tags')
  const searchPath = new URL(`${API_BASE_URL}/tags`).pathname
  const searched = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === searchPath &&
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

test('marks the Create Tag name field invalid when the name is taken or empty', async ({ page, request }) => {
  const user = await signUpUser(request)
  const name = `Holiday ${crypto.randomUUID()}`
  const created = await request.post(`${API_BASE_URL}/tags`, { headers: asUser(user), data: { name } })
  expect(created.status()).toBe(201)

  await logInViaApi(page, user)
  await openPage(page, '/settings#tags')
  await page.locator('#tags').getByRole('button', { name: 'Create tag', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create Tag' })
  const field = dialog.getByRole('textbox', { name: 'Tag Name', exact: true })
  const create = dialog.getByRole('button', { name: 'Create', exact: true })

  await field.fill(name)
  await create.click()
  await expect(dialog.getByRole('alert')).toHaveText('Tag with this name already exists')
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(field).toHaveAccessibleDescription('Tag with this name already exists')

  // Typing clears both the message and the mark
  await field.press('End')
  await field.pressSequentially('!')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(field).not.toHaveAttribute('aria-invalid', 'true')

  await field.fill('')
  await create.click()
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(field).toHaveAccessibleDescription('Name is required.')
})

// A failure the server gave no explanation for, such as a 500 with an empty body, is told in the app's
// own words rather than as a status code nobody wrote for the user
test('says something went wrong when creating a tag fails with no explanation', async ({ page, request }) => {
  const user = await signUpUser(request)
  await page.route(`${API_BASE_URL}/tags`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await route.fulfill({ status: 500, body: '' })
  })

  await logInViaApi(page, user)
  await openPage(page, '/settings#tags')
  await page.locator('#tags').getByRole('button', { name: 'Create tag', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create Tag' })
  await dialog.getByRole('textbox', { name: 'Tag Name', exact: true }).fill('Holiday')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()

  await expect(dialog.getByRole('alert')).toHaveText('Oops, something went wrong. Please try again.')
})
