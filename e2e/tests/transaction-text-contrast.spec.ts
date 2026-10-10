import { expect, test } from '@playwright/test'

import { asUser, createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { faintestText } from '../support/contrast'
import { API_BASE_URL } from '../support/target'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs at every size: transaction rows take their own layouts below 1300px

/**
 * Guards the contrast of a transaction row on an archived account. The row used to be faded as a whole,
 * which took its muted text and its read-only label under the 4.5:1 every text needs
 */

for (const colorScheme of ['light', 'dark'] as const) {
  // The same row on both lists that show it, the read-only label with it
  test(`draws every text on an archived account's row at full contrast in the ${colorScheme} theme`, AT_EVERY_SIZE, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday' })
    const id = await createTransaction(request, user, {
      accountId: account.id,
      categoryName: 'Groceries',
      amount: -1000,
      date: daysFromTodayInTestTimezone(-1),
      notes: 'Account archived',
    })
    const archived = await request.patch(`${API_BASE_URL}/accounts/${account.id}`, { headers: asUser(user), data: { is_archived: true } })
    expect(archived.status()).toBe(200)
    await logInViaApi(page, user)
    const row = page.getByTestId(`transaction-row-${id}`)

    for (const path of ['/transactions', `/accounts/${account.id}`]) {
      await openPage(page, path)
      await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
      await expect(row.getByText('Archived · Read-only', { exact: true }).filter({ visible: true }).first()).toBeVisible()
      // Read until the row has finished coming in, since it starts transparent and every text on it
      // measures as nothing to read until then
      await expect.poll(() => faintestText(row.locator('..')), { message: path })
        .toMatchObject({ text: expect.stringMatching(/\S/), contrast: expect.any(Number) })
      const faintest = await faintestText(row.locator('..'))
      expect(faintest.contrast, `"${faintest.text}" on ${path}`).toBeGreaterThanOrEqual(4.5)
    }
  })
}
