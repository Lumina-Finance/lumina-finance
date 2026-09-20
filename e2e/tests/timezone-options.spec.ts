import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logIn, openPage, waitForPageReady } from '../support/app'
import { API_BASE_URL } from '../support/target'

test.use({ timezoneId: 'UTC' })

test('preserves a saved UTC timezone when another profile field is saved', async ({ page, request }) => {
  const user = await signUpUser(request)
  const headers = { Authorization: `Bearer ${user.accessToken}` }
  const seeded = await request.patch(`${API_BASE_URL}/me`, { headers, data: { tz: 'UTC' } })
  expect(seeded.status()).toBe(200)

  await logIn(page, user)
  await openPage(page, '/settings')
  const profile = page.locator('section#profile')
  const timezone = profile.getByRole('combobox', { name: 'Timezone', exact: true })
  await expect(timezone).toHaveText('UTC')
  await timezone.click()
  await expect(page.getByRole('option', { name: 'UTC', exact: true })).toHaveCount(1)
  await page.getByRole('option', { name: 'UTC', exact: true }).click()
  await profile.getByRole('textbox', { name: 'First name', exact: true }).fill('UTC profile saved')
  const saved = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/me` && response.request().method() === 'PATCH')
  await profile.getByRole('button', { name: 'Save', exact: true }).click()
  const response = await saved
  expect(response.status()).toBe(200)
  expect((await response.json() as { tz: string }).tz).toBe('UTC')

  await page.reload()
  await waitForPageReady(page)
  await expect(profile.getByRole('textbox', { name: 'First name', exact: true })).toHaveValue('UTC profile saved')
  await expect(timezone).toHaveText('UTC')
  const persisted = await request.get(`${API_BASE_URL}/me`, { headers })
  expect(persisted.status()).toBe(200)
  expect((await persisted.json() as { tz: string }).tz).toBe('UTC')
})

test('shows the browser UTC timezone selected in the signup form', async ({ page }) => {
  await page.goto('/signup')
  const timezone = page.getByRole('combobox', { name: 'Timezone', exact: true })
  await expect(timezone).toHaveText('UTC')
  await timezone.click()
  await expect(page.getByRole('option', { name: 'UTC', exact: true })).toHaveCount(1)
})

test('shows the browser UTC timezone in the real OIDC onboarding form', async ({ page }) => {
  const code = `e2e-code-${crypto.randomUUID()}`
  const state = `e2e-state-${crypto.randomUUID()}`
  const email = `e2e-oidc-${crypto.randomUUID()}@example.com`
  let callbacks = 0
  await page.route(`${API_BASE_URL}/auth/oidc/callback`, async (route) => {
    const request = route.request()
    if (request.method() !== 'POST') {
      await route.continue()
      return
    }
    const body = request.postDataJSON() as { code?: string; state?: string }
    if (body.code !== code || body.state !== state) {
      await route.continue()
      return
    }
    callbacks += 1
    await route.fulfill({
      status: 200,
      json: {
        onboarding_required: true,
        onboarding_token: `e2e-token-${crypto.randomUUID()}`,
        email,
        first_name: 'UTC onboarding',
        last_name: null,
      },
    })
  })
  await page.goto(`/auth/oidc/callback?${new URLSearchParams({ code, state })}`)
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(email)
  const timezone = page.getByRole('combobox', { name: 'Timezone', exact: true })
  await expect(timezone).toHaveText('UTC')
  await timezone.click()
  await expect(page.getByRole('option', { name: 'UTC', exact: true })).toHaveCount(1)
  expect(callbacks).toBe(1)
})
