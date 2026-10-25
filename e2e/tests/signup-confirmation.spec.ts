import { expect, test, type Page } from '@playwright/test'

import { signUpUser, TEST_PASSWORD } from '../support/api'
import { expectSignedIn, requestSignUpThroughTheForm, signUpThroughTheForm } from '../support/app'
import { countEmailsTo, waitForConfirmationLink } from '../support/mail'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: confirming a sign-up gives the same result at every size

/** Choose a password on the confirm-email page the link opened, and submit it */
async function chooseTestPassword(page: Page): Promise<void> {
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByLabel('Confirm password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
}

test('shows the check-your-email view and creates no account until the link is used', async ({ page }) => {
  const email = await requestSignUpThroughTheForm(page)
  await expect(page.getByText(`We've sent a message to ${email}`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to login' })).toBeVisible()

  // The address has no password yet, so the login form refuses it as it refuses any stranger
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()

  await expect(page.getByText('Incorrect email or password. Please try again.')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('creates the account and signs in once the emailed link is used', async ({ page, request }) => {
  const email = await signUpThroughTheForm(page)

  // The offer of a second factor is optional, and skipping it opens the app
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.getByRole('button', { name: 'I still want to skip' }).click()
  await expectSignedIn(page)

  const login = await request.post(`${API_BASE_URL}/auth/login`, { data: { email, password: TEST_PASSWORD } })
  expect(login.status()).toBe(200)
})

test('says the link is not valid when it is used a second time', async ({ page, browser }) => {
  const email = await signUpThroughTheForm(page)
  const link = await waitForConfirmationLink(email)

  // The first use already made the account, so the same link has nothing left to confirm. A fresh
  // browser context stands in for another device, since the first one's session would skip the page
  const other = await browser.newContext()
  try {
    const otherPage = await other.newPage()
    await otherPage.goto(link)
    await chooseTestPassword(otherPage)

    await expect(otherPage.getByRole('heading', { name: 'Link not valid' })).toBeVisible()
    await expect(otherPage.getByRole('heading', { name: 'Account created' })).toHaveCount(0)
  } finally {
    await other.close()
  }
})

test('shows the same view and sends no email when the address already has an account', async ({ page, request }) => {
  const user = await signUpUser(request)

  // Creating the account already emailed this address its confirmation link, so only new mail counts
  const emailsBefore = await countEmailsTo(user.email)

  // The helper expects the exact status text a new address gets, so reaching past it is the proof
  await requestSignUpThroughTheForm(page, user.email)

  await expect(page.getByText(`We've sent a message to ${user.email}`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to login' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign up', exact: true })).toHaveCount(0)

  // The next sign-up's email arriving gives any send the registered address's request started time to
  // land first. The backend tests prove nothing is sent at all
  const later = await requestSignUpThroughTheForm(page)
  await waitForConfirmationLink(later)
  expect(await countEmailsTo(user.email)).toBe(emailsBefore)
})

for (const size of [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`shows a long address in full on the confirm page at ${size.name} width`, async ({ page }) => {
    const email = await requestSignUpThroughTheForm(page, `e2e-${crypto.randomUUID()}-with-a-long-name@example.com`)
    await page.setViewportSize({ width: size.width, height: size.height })
    await page.goto(await waitForConfirmationLink(email))

    // A read-only value wider than its box is cut at the edge, hiding the end of the address
    const shown = page.getByLabel('Email')
    await expect(shown).toBeVisible()
    const { scrollWidth, clientWidth } = await shown.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })
}
