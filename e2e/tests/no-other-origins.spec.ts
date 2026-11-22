import { expect, test, type Page } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL, BASE_URL } from '../support/target'

// Runs on desktop only: the emoji panel is checked at one size, and what it loads does not depend on the width

const INSTANCE_ORIGINS = new Set([new URL(BASE_URL).origin, new URL(API_BASE_URL).origin])

// Refuses and records every request to a site other than the instance, so a page that still reaches
// for one shows up here and also proves it works with those sites unreachable
async function refuseOtherOrigins(page: Page) {
  const refused: string[] = []
  await page.route(
    (url) => url.protocol.startsWith('http') && !INSTANCE_ORIGINS.has(url.origin),
    (route) => {
      refused.push(route.request().url())
      return route.abort('connectionrefused')
    },
  )
  return refused
}

test('shows a provider named after a shipped app with its logo, and contacts no other site', async ({ page }) => {
  const refused = await refuseOtherOrigins(page)
  // A page on another origin than the server needs the headers the server would send to read the answer
  await page.route(`${API_BASE_URL}/auth/oidc/providers`, (route) =>
    route.fulfill({
      headers: { 'access-control-allow-origin': new URL(BASE_URL).origin, 'access-control-allow-credentials': 'true' },
      json: {
        providers: [
          { slug: 'generic', display_name: 'Authentik' },
          { slug: 'other', display_name: 'Acme Sign-On' },
        ],
      },
    }),
  )

  await page.goto('/login')
  const known = page.getByRole('button', { name: 'Continue with Authentik' })
  const unknown = page.getByRole('button', { name: 'Continue with Acme Sign-On' })
  await expect(known).toBeVisible()
  await expect(unknown).toBeVisible()
  await page.waitForLoadState('networkidle')

  const logo = known.locator('img')
  await expect(logo).toHaveCount(1)
  expect(new URL((await logo.getAttribute('src'))!, page.url()).origin).toBe(new URL(BASE_URL).origin)
  expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  // A provider with no shipped logo keeps the globe
  await expect(unknown.locator('img')).toHaveCount(0)
  await expect(unknown.locator('svg')).toHaveCount(1)
  expect(refused).toEqual([])
})

test('opens the emoji panel with every other site unreachable and contacts none', async ({ page, request }) => {
  const refused = await refuseOtherOrigins(page)
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#categories')
  await page.locator('#categories').getByRole('button', { name: 'Create category', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create category' })
  await dialog.getByRole('button', { name: 'Select New category icon' }).click()

  const panel = page.getByRole('dialog', { name: 'Select New category icon' })
  const search = panel.getByRole('searchbox')
  await expect(search).toBeVisible({ timeout: 15000 })
  // The panel draws the search box a frame before moving focus into it, and the keys go wherever focus is
  await expect(search).toBeFocused()
  await page.keyboard.type('dog')
  await expect(search).toHaveValue('dog')
  await expect(panel.getByRole('button', { name: '🐶', exact: true })).toBeVisible()

  expect(refused).toEqual([])
})
