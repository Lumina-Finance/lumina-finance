import { expect, test } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { logIn, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: what a reload restores comes from browser storage, the same at every size

// Every tab shares the refresh cookie, so once another user signs in in a second tab, a renewal in the
// first returns that user's session. The first tab signs out rather than switch to them
test('signs a tab out when its renewal returns a user signed in since in another tab', async ({ page, context, request }) => {
  const first = await signUpUser(request)
  const firstAccount = await createAccount(request, first, { name: 'First user chequing' })
  const firstRow = await createTransaction(request, first, { accountId: firstAccount.id, categoryName: 'Groceries', amount: -1000 })
  const second = await signUpUser(request)
  const secondAccount = await createAccount(request, second, { name: 'Second user chequing' })
  const secondRow = await createTransaction(request, second, { accountId: secondAccount.id, categoryName: 'Dining', amount: -2000 })

  await logIn(page, first)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(`transaction-row-${firstRow}`)).toBeVisible()

  // The second user signs in in another tab
  const other = await context.newPage()
  await openPage(other, '/transactions')
  await other.getByRole('button', { name: 'Log out', exact: true }).click()
  await other.waitForURL((url) => url.pathname.startsWith('/login'))
  await logIn(other, second)
  await openPage(other, '/transactions')
  await expect(other.getByTestId(`transaction-row-${secondRow}`)).toBeVisible()

  // The first tab's next request is refused as expired, so it renews through the shared cookie
  const renewed = page.waitForResponse(`${API_BASE_URL}/auth/refresh`)
  const isSearch = (url: URL) => url.href.startsWith(`${API_BASE_URL}/transactions`) && url.search.includes('offee')
  await page.route(isSearch, (route) => route.fulfill({
    status: 401,
    headers: {
      'Access-Control-Allow-Origin': route.request().headers()['origin'],
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'WWW-Authenticate',
      'WWW-Authenticate': 'Bearer',
    },
    contentType: 'application/json',
    body: JSON.stringify({ detail: 'Token is not active' }),
  }), { times: 1 })
  const sentWith: string[] = []
  page.on('request', (sent) => {
    if (sent.url().startsWith(API_BASE_URL)) sentWith.push(sent.headers()['authorization'] ?? '')
  })
  await page.getByPlaceholder('Search transactions...', { exact: true }).fill('offee')
  const secondToken = (await (await renewed).json() as { access_token: string }).access_token
  expect(secondToken).toEqual(expect.any(String))

  await page.waitForURL((url) => url.pathname.startsWith('/login'))
  expect(sentWith).not.toContain(`Bearer ${secondToken}`)
})
