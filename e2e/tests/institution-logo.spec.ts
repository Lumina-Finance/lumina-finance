import { expect, test, type Page } from '@playwright/test'

import { asUser, createAccount, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: which logo an account row draws doesn't depend on the width

const FAVICON_SERVICE_PATTERN = 'https://t2.gstatic.com/faviconV2**'

// A name is taken once per country across the database, so a retry in a new worker needs a name of its own
const RUN_TAG = crypto.randomUUID().slice(0, 8)

const BANKS = [
  { name: `Tiny Bank ${RUN_TAG}`, website: 'https://tiny.example', logoWidth: 16 },
  { name: `Small Bank ${RUN_TAG}`, website: 'https://small.example', logoWidth: 32 },
  { name: `Broken Bank ${RUN_TAG}`, website: 'https://broken.example', logoWidth: null },
]

function iconFor(width: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}"><rect width="${width}" height="${width}" fill="#0a6"/></svg>`
}

// Answers the icon service from the browser, so the test needs no outside network and controls each size
async function stubIconService(page: Page) {
  await page.route(FAVICON_SERVICE_PATTERN, async (route) => {
    const requested = decodeURIComponent(new URL(route.request().url()).searchParams.get('url') ?? '')
    const bank = BANKS.find((item) => requested.startsWith(item.website))
    if (!bank || bank.logoWidth === null) {
      await route.abort()
      return
    }
    await route.fulfill({ contentType: 'image/svg+xml', body: iconFor(bank.logoWidth) })
  })
}

async function seedAccountAt(request: Parameters<typeof createAccount>[0], user: TestUser, bank: (typeof BANKS)[number]) {
  const created = await request.post(`${API_BASE_URL}/institutions`, {
    headers: asUser(user),
    data: { name: bank.name, country_code: 'US', website: bank.website },
  })
  expect(created.status()).toBe(201)
  const { id } = (await created.json()) as { id: string }
  await createAccount(request, user, { name: `${bank.name} account`, institutionId: id })
}

test('shows every logo the icon service returns, a 16px one included, and falls back only when it fails to load', async ({
  page,
  request,
}) => {
  const user = await signUpUser(request)
  for (const bank of BANKS) await seedAccountAt(request, user, bank)

  await stubIconService(page)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  const row = (name: string) => page.getByRole('link', { name: new RegExp(`${name} account`) })

  // The icon that fails to load is the fence: its error is handled by the same code that would drop a loaded icon,
  // so once its "$" shows, a loaded icon that was going to be dropped has been
  const broken = row(BANKS[2].name)
  await expect(broken.getByText('$', { exact: true })).toBeVisible()
  await expect(broken.getByRole('img')).toHaveCount(0)

  for (const bank of BANKS.filter((item) => item.logoWidth !== null)) {
    const logo = row(bank.name).getByRole('img', { name: `${bank.name} logo` })
    await expect(logo).toHaveJSProperty('naturalWidth', bank.logoWidth)
    await expect(row(bank.name).getByText('$', { exact: true })).toHaveCount(0)
  }
})
