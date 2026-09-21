import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { createAccount, findReferenceId, signUpUser, TEST_CURRENCY, todayInTestTimezone } from '../support/api'
import { chooseFromDropdown, expectSignedIn, openModal, openPage, logInViaApi } from '../support/app'
import { API_BASE_URL } from '../support/target'

async function setupMerchantRanking(page: Page, request: APIRequestContext, withExpense = false) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Merchant usage account' })
  const headers = { Authorization: `Bearer ${user.accessToken}` }
  const prefix = `E2E ranking ${crypto.randomUUID()}`
  const alpha = `${prefix} Alpha`
  const zulu = `${prefix} Zulu`
  let zuluId!: string
  for (const name of [alpha, zulu]) {
    const response = await request.post(`${API_BASE_URL}/merchants`, { headers, data: { name } })
    expect(response.status()).toBe(201)
    if (name === zulu) zuluId = (await response.json() as { id: string }).id
  }
  let transactionId: string | undefined
  if (withExpense) {
    const categoryId = await findReferenceId(request, user, 'categories', 'Groceries')
    const response = await request.post(`${API_BASE_URL}/transactions`, {
      headers,
      data: { account_id: account.id, category_id: categoryId, merchant_id: zuluId, amount: -4250, currency: TEST_CURRENCY, dt: todayInTestTimezone() },
    })
    expect(response.status()).toBe(201)
    transactionId = (await response.json() as { id: string }).id
  }
  await logInViaApi(page, user)
  await openPage(page, '/accounts')
  await expectSignedIn(page)

  /** Navigate through the responsive app links, preserving the live query cache */
  async function navigate(name: 'Settings' | 'Accounts') {
    const menu = page.getByRole('button', { name: 'Open navigation menu', exact: true })
    if (await menu.isVisible()) await menu.click()
    await page.getByRole('navigation', { name: 'Primary', exact: true })
      .getByRole('link', { name, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/${name.toLowerCase()}$`))
  }

  /** Open the seeded account through its actual account-list link */
  async function openAccount() {
    await navigate('Accounts')
    await page.locator(`a[href="/accounts/${account.id}"]`).click()
    await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}$`))
  }

  /** Read the real responsive list's accessible edit actions in rendered merchant order */
  async function expectOrder(names: string[]) {
    await navigate('Settings')
    const section = page.locator('section#merchants')
    const search = section.getByPlaceholder('Search merchants...', { exact: true })
    await search.fill(prefix)
    await search.press('Enter')
    const actions = section.getByRole('button', { name: new RegExp(`^Edit ${prefix}`) })
    await expect(actions).toHaveCount(2)
    await expect.poll(() => actions.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))))
      .toEqual(names.map((name) => `Edit ${name}`))
  }

  return { account, alpha, zulu, zuluId, transactionId, expectOrder, openAccount }
}

test('refreshes merchant usage order after creating an expense', async ({ page, request }) => {
  const { account, alpha, zulu, zuluId, expectOrder, openAccount } = await setupMerchantRanking(page, request)
  await expectOrder([alpha, zulu])
  await openAccount()
  const dialog = await openModal(page, ['Add Transaction', 'Add transaction'], 'Add Transaction')
  await chooseFromDropdown(dialog, 'Category', 'Groceries')
  await chooseFromDropdown(dialog, 'Merchant', zulu)
  await dialog.getByRole('textbox', { name: 'Amount', exact: true }).fill('42.50')
  const created = page.waitForResponse((response) => {
    if (response.url() !== `${API_BASE_URL}/transactions` || response.request().method() !== 'POST') return false
    const body = response.request().postDataJSON() as { account_id?: string; merchant_id?: string }
    return body.account_id === account.id && body.merchant_id === zuluId
  })
  await dialog.getByTestId('transaction-submit').click()
  const response = await created
  expect(response.status()).toBe(201)
  await expect(dialog).toBeHidden()
  await expectOrder([zulu, alpha])
})

test('refreshes merchant usage order after deleting an expense', async ({ page, request }) => {
  const { alpha, zulu, transactionId, expectOrder, openAccount } = await setupMerchantRanking(page, request, true)
  await expectOrder([zulu, alpha])
  await openAccount()
  const row = page.getByTestId(`transaction-row-${transactionId}`)
  await row.click()
  const edit = page.getByRole('dialog', { name: 'Edit Transaction', exact: true })
  const remove = edit.getByTestId('transaction-delete')
  await expect(remove).toHaveAccessibleName('Delete')
  await remove.click()
  await expect(remove).toHaveAccessibleName('Yes, delete')
  const deleted = page.waitForResponse((result) =>
    result.url() === `${API_BASE_URL}/transactions/${transactionId}` && result.request().method() === 'DELETE')
  await remove.click()
  expect((await deleted).status()).toBe(204)
  await expect(edit).toBeHidden()
  await expect(row).toBeHidden()
  await expectOrder([alpha, zulu])
})
