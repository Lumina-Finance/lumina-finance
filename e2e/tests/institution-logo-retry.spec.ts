import { expect, test, type Page } from '@playwright/test'

import { asUser, createAccount, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: whether a failed logo is drawn again doesn't depend on the width

const FAVICON_SERVICE_PATTERN = 'https://t2.gstatic.com/faviconV2**'

// The most loads of one failing logo the app may attempt before it settles on the placeholder. A row that
// mounts as another is failing asks for the same logo, so a load can be requested twice
const MOST_REQUESTS = 2 * 3

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#0a6"/></svg>'

// Answers the icon service from the browser. It drops every load until `isUp` is set, then answers them
async function stubIconService(page: Page) {
  const service = { requests: 0, isUp: false }
  await page.route(FAVICON_SERVICE_PATTERN, async (route) => {
    service.requests += 1
    if (!service.isUp) {
      await route.abort('connectionreset')
      return
    }
    await route.fulfill({ contentType: 'image/svg+xml', body: ICON })
  })
  return service
}

async function seedAccount(request: Parameters<typeof createAccount>[0], user: TestUser, name: string) {
  const created = await request.post(`${API_BASE_URL}/institutions`, {
    headers: asUser(user),
    data: { name, country_code: 'US', website: 'https://retry-bank.example' },
  })
  expect(created.status()).toBe(201)
  const { id } = (await created.json()) as { id: string }
  await createAccount(request, user, { name: `${name} account`, institutionId: id })
}

// Opens the accounts list while the icon service drops every load, and waits for the placeholder
async function openFailedAccountRow(page: Page, request: Parameters<typeof createAccount>[0]) {
  const user = await signUpUser(request)
  // A name is taken once per country across the database, so each test and retry needs one of its own
  const bank = `Retry Bank ${crypto.randomUUID().slice(0, 8)}`
  await seedAccount(request, user, bank)
  const service = await stubIconService(page)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')
  const row = page.getByRole('link', { name: new RegExp(`${bank} account`) })
  await expect(row.getByText('$', { exact: true })).toBeVisible()
  await expect(row.getByRole('img')).toHaveCount(0)
  return { row, bank, service }
}

test('draws a logo that failed to load once the connection returns, without a reload', async ({ page, request }) => {
  const { row, bank, service } = await openFailedAccountRow(page, request)

  service.isUp = true
  await page.evaluate(() => window.dispatchEvent(new Event('online')))

  await expect(row.getByRole('img', { name: `${bank} logo` })).toHaveJSProperty('naturalWidth', 32)
  await expect(row.getByText('$', { exact: true })).toHaveCount(0)
})

test('draws a logo that failed to load again when the page is shown again', async ({ page, request }) => {
  const { row, bank, service } = await openFailedAccountRow(page, request)

  service.isUp = true
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))

  await expect(row.getByRole('img', { name: `${bank} logo` })).toHaveJSProperty('naturalWidth', 32)
})

test('draws a logo that failed to load when its page is opened again some time later', async ({ page, request }) => {
  const { row, bank, service } = await openFailedAccountRow(page, request)

  service.isUp = true
  // The app leaves a logo that just failed alone, so the first visits within its delay keep the placeholder
  await expect(async () => {
    await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click()
    // Leaving before the list has gone would keep its rows, and so their logos, mounted
    await expect(row).toHaveCount(0)
    await page.getByRole('link', { name: 'Accounts', exact: true }).first().click()
    await expect(row).toBeVisible()
    await expect(row.getByRole('img', { name: `${bank} logo` })).toBeVisible({ timeout: 1500 })
  }).toPass({ timeout: 30_000 })

  await expect(row.getByRole('img', { name: `${bank} logo` })).toHaveJSProperty('naturalWidth', 32)
})

test('tries a logo that always fails a limited number of times, then keeps the placeholder', async ({ page, request }) => {
  const { row, service } = await openFailedAccountRow(page, request)

  for (let event = 0; event < 6; event += 1) {
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await page.waitForLoadState('networkidle')
  }

  await expect(row.getByText('$', { exact: true })).toBeVisible()
  expect(service.requests).toBeLessThanOrEqual(MOST_REQUESTS)
})
