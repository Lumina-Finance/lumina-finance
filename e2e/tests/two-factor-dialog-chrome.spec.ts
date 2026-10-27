/**
 * Guards the step-up, authenticator setup and recovery code dialogs against going back to a plain panel: each
 * carries the labelled rail along its edge and a serif title, as the dialogs it opens from do
 */
import { expect, test, type Locator } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the rail is drawn from the sm width up, and both phone widths hide it

/** The rail's label is drawn and the title is set in the app's serif */
async function expectRailAndSerifTitle(dialog: Locator, railLabel: string): Promise<void> {
  await expect(dialog.getByText(railLabel, { exact: true }).filter({ visible: true })).toBeVisible()
  const titleFont = await dialog.getByRole('heading').first().evaluate((heading) => getComputedStyle(heading).fontFamily)
  expect(titleFont).toContain('Cormorant Garamond')
}

test('draws the rail and serif title on the step-up and authenticator setup dialogs', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')
  await page.locator('#security').getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('button', { name: 'Enable' }).click()

  const stepUp = page.getByRole('dialog', { name: 'Turn on two-factor authentication' })
  await expectRailAndSerifTitle(stepUp, 'Verify')
  await stepUp.getByPlaceholder('Current password').fill(user.password)
  await stepUp.getByRole('button', { name: 'Continue' }).click()

  const setup = page.getByRole('dialog', { name: 'Set up two-factor authentication' })
  await expectRailAndSerifTitle(setup, 'Two-factor')
})

test('draws the rail and serif title on the recovery codes dialog', async ({ page, request }) => {
  const user = await signUpUser(request)

  // Report an authenticator as on and stand in for the regeneration, so the account needs no real factor
  await page.route(`${API_BASE_URL}/auth/2fa/status`, (route) => route.fulfill({ json: { totp_enabled: true } }))
  await page.route(`${API_BASE_URL}/auth/2fa/recovery-codes`, (route) =>
    route.fulfill({ json: { recovery_codes: Array.from({ length: 10 }, (_, i) => `aaaa-bbbb-cccc-dddd-${i}000`) } }))

  await logInViaApi(page, user)
  await openPage(page, '/settings#security')
  await page.locator('#security').getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('button', { name: 'Regenerate' }).click()
  const stepUp = page.getByRole('dialog', { name: 'Regenerate recovery codes' })
  await stepUp.getByPlaceholder('Current password').fill(user.password)
  await stepUp.getByRole('button', { name: 'Continue' }).click()
  await stepUp.getByLabel('One-time code').pressSequentially('123456')
  await stepUp.getByRole('button', { name: 'Regenerate' }).click()

  const codes = page.getByRole('dialog', { name: 'Your new recovery codes' })
  await expectRailAndSerifTitle(codes, 'Recovery')

  // The browser's own blue tick would be the one colour on the dialog outside the app's palette
  for (const box of await codes.getByRole('checkbox').all()) {
    expect(await box.evaluate((input) => getComputedStyle(input).accentColor)).not.toBe('auto')
  }
})
