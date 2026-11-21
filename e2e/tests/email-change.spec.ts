/**
 * Guards changing the account email from the Security card: Save asks for the password, the new address
 * is emailed a link, opening it in the signed-in browser and clicking Confirm email changes the address
 * and signs the browser out, and from then on only the new address logs in. It also guards a wrong password
 * keeping the dialogue open, the notice clearing on the next edit, a spent link's invalid view, a browser
 * holding another account staying signed in, and a passwordless account sending the request on its return
 */
import { expect, test } from '@playwright/test'

import { asUser, signUpUser } from '../support/api'
import { expectSignedIn, logIn, logInViaApi, openPage } from '../support/app'
import { countEmailsTo, waitForEmailChangeLink } from '../support/mail'
import { API_BASE_URL, BASE_URL } from '../support/target'

// Runs on desktop only: the card, its dialogue and the confirm page behave the same at every size

test('changes the email through the Security card and the emailed link', async ({ page, request }) => {
  const user = await signUpUser(request)
  const newEmail = `e2e-${crypto.randomUUID()}@example.com`
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')

  const card = page.locator('#security')
  await card.getByLabel('Email', { exact: true }).fill(newEmail)
  await card.getByRole('button', { name: 'Save', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: "Confirm it's you" })
  await dialog.getByLabel('Current password').fill(user.password)
  await dialog.getByRole('button', { name: 'Send email' }).click()

  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'sent a confirmation email' })).toHaveText(
    `We've sent a confirmation email to ${newEmail}. Please confirm your email using the link included in the email.`,
  )
  // The address on the account stays as it was until the link is used
  await expect(card.getByLabel('Email', { exact: true })).toHaveValue(user.email)

  // The requester usually opens the link in the browser they asked from, so it is opened signed in. The
  // page only asks, since a mail scanner opening the link must not spend it
  await page.goto(await waitForEmailChangeLink(newEmail))
  await expect(page.getByRole('heading', { name: 'Confirm your new email' })).toBeVisible()
  await page.getByRole('button', { name: 'Confirm email' }).click()
  await expect(page.getByRole('heading', { name: 'Email changed' })).toBeVisible()
  await expect(page.getByText(`Your email is now ${newEmail}. Please log in with it.`)).toBeVisible()

  // Every session ended, this browser's included, so the login page shows instead of sending the browser home
  await page.getByRole('link', { name: 'Log in' }).click()
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()

  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByText('Incorrect email or password. Please try again.')).toBeVisible()

  await logIn(page, { ...user, email: newEmail })
  await expectSignedIn(page)
})

test('keeps the dialogue open with its error after a wrong password, and clears the notice when the email is edited again', async ({
  page,
  request,
}) => {
  const user = await signUpUser(request)
  const newEmail = `e2e-${crypto.randomUUID()}@example.com`
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')

  const card = page.locator('#security')
  const field = card.getByLabel('Email', { exact: true })
  await field.fill(newEmail)
  await card.getByRole('button', { name: 'Save', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: "Confirm it's you" })
  await dialog.getByLabel('Current password').fill('WrongPassw0rd!')
  await dialog.getByRole('button', { name: 'Send email' }).click()

  await expect(dialog.getByRole('alert')).toContainText('Your password was incorrect.')
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'sent a confirmation email' })).toHaveCount(0)

  await dialog.getByLabel('Current password').fill(user.password)
  await dialog.getByRole('button', { name: 'Send email' }).click()
  await expect(dialog).toHaveCount(0)
  const notice = page.getByRole('status').filter({ hasText: 'sent a confirmation email' })
  await expect(notice).toBeVisible()

  // Editing the field again withdraws the notice, since it no longer describes what is typed
  await field.fill(`other-${newEmail}`)
  await expect(notice).toHaveCount(0)
})

test('refuses the own address typed with its domain in capitals, on the field, and sends no email', async ({
  page,
  request,
}) => {
  const user = await signUpUser(request)
  const [local, domain] = user.email.split('@')
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')
  const mailBefore = await countEmailsTo(user.email)

  const card = page.locator('#security')
  const field = card.getByLabel('Email', { exact: true })
  await field.fill(`${local}@${domain.toUpperCase()}`)
  await card.getByRole('button', { name: 'Save', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: "Confirm it's you" })
  await dialog.getByLabel('Current password').fill(user.password)
  await dialog.getByRole('button', { name: 'Send email' }).click()

  // The server reads the address as the account's own, so the refusal lands on the field, not in the dialogue
  await expect(dialog).toHaveCount(0)
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(card.getByText('This is already your email address. Please enter a different one')).toBeVisible()
  expect(await countEmailsTo(user.email)).toBe(mailBefore)
})

test('shows the invalid view for a link that is no longer valid', async ({ page, request }) => {
  const user = await signUpUser(request)
  const newEmail = `e2e-${crypto.randomUUID()}@example.com`
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')

  const card = page.locator('#security')
  await card.getByLabel('Email', { exact: true }).fill(newEmail)
  await card.getByRole('button', { name: 'Save', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: "Confirm it's you" })
  await dialog.getByLabel('Current password').fill(user.password)
  await dialog.getByRole('button', { name: 'Send email' }).click()
  await expect(dialog).toHaveCount(0)

  // The link works once, so the second opening finds it spent
  const link = await waitForEmailChangeLink(newEmail)
  await page.goto(link)
  await page.getByRole('button', { name: 'Confirm email' }).click()
  await expect(page.getByRole('heading', { name: 'Email changed' })).toBeVisible()
  await page.goto(link)
  await page.getByRole('button', { name: 'Confirm email' }).click()

  await expect(page.getByRole('heading', { name: 'Link not valid' })).toBeVisible()
  await expect(
    page.getByText(
      'This confirmation link is invalid or has expired, or the email is unavailable. Please try again.',
    ),
  ).toBeVisible()
})

test('keeps the app usable after a spent link is opened again in a browser signed in with the new address', async ({
  page,
  request,
}) => {
  const user = await signUpUser(request)
  const newEmail = `e2e-${crypto.randomUUID()}@example.com`
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')

  const card = page.locator('#security')
  await card.getByLabel('Email', { exact: true }).fill(newEmail)
  await card.getByRole('button', { name: 'Save', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: "Confirm it's you" })
  await dialog.getByLabel('Current password').fill(user.password)
  await dialog.getByRole('button', { name: 'Send email' }).click()
  await expect(dialog).toHaveCount(0)

  const link = await waitForEmailChangeLink(newEmail)
  await page.goto(link)
  await page.getByRole('button', { name: 'Confirm email' }).click()
  await expect(page.getByRole('heading', { name: 'Email changed' })).toBeVisible()
  await logIn(page, { ...user, email: newEmail })
  await expectSignedIn(page)

  // The same link, now spent, is opened in the browser that holds the account's new session
  await page.goto(link)
  await page.getByRole('button', { name: 'Confirm email' }).click()
  await expect(page.getByRole('heading', { name: 'Link not valid' })).toBeVisible()

  // The session still works, so the app opens instead of staying on its loading screen
  await openPage(page, '/settings#security')
  await expect(page.locator('#security').getByLabel('Email', { exact: true })).toHaveValue(newEmail)
})

test('leaves a browser signed in as another account signed in after it confirms someone else’s link', async ({
  page,
  request,
}) => {
  const owner = await signUpUser(request)
  const bystander = await signUpUser(request)
  const newEmail = `e2e-${crypto.randomUUID()}@example.com`
  const response = await request.post(`${API_BASE_URL}/auth/email/change`, {
    headers: asUser(owner),
    data: { new_email: newEmail, step_up: { password: owner.password } },
  })
  expect(response.status()).toBe(204)

  await logInViaApi(page, bystander)
  await page.goto(await waitForEmailChangeLink(newEmail))
  await page.getByRole('button', { name: 'Confirm email' }).click()
  await expect(page.getByRole('heading', { name: 'Email changed' })).toBeVisible()

  // The link was for another account, so this browser's own session still works
  await openPage(page, '/settings#security')
  await expect(page.locator('#security').getByLabel('Email', { exact: true })).toHaveValue(bystander.email)
})

test('sends the request once a passwordless account returns from its provider', async ({ page, request }) => {
  const user = await signUpUser(request)
  const newEmail = `e2e-${crypto.randomUUID()}@example.com`
  const sent: string[] = []

  // The provider is stubbed end to end, as in the sign-out spec, with its page replaced by its return to the app
  await page.route(`${API_BASE_URL}/auth/oidc/identities`, (route) =>
    route.fulfill({
      json: {
        has_password: false,
        identities: [
          {
            id: 'identity-stub-provider',
            provider_slug: 'stub-provider',
            provider_display_name: 'stub-provider',
            email: 'someone@example.com',
            created_at: new Date().toISOString(),
            last_login_at: null,
          },
        ],
      },
    }),
  )
  await page.route(`${API_BASE_URL}/auth/oidc/reauth`, (route) =>
    route.fulfill({ json: { authorization_url: `${BASE_URL}/auth/oidc/callback?code=stub-code&state=stub-state` } }),
  )
  await page.route(`${API_BASE_URL}/auth/oidc/reauth/callback`, (route) => route.fulfill({ status: 204 }))
  await page.route(`${API_BASE_URL}/auth/email/change`, (route) => {
    sent.push(route.request().postData() ?? '')
    return route.fulfill({ status: 204 })
  })

  await logInViaApi(page, user)
  await openPage(page, '/settings#security')
  const card = page.locator('#security')
  await card.getByLabel('Email', { exact: true }).fill(newEmail)
  await card.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(page.getByRole('status').filter({ hasText: 'sent a confirmation email' })).toHaveText(
    `We've sent a confirmation email to ${newEmail}. Please confirm your email using the link included in the email.`,
  )
  expect(sent).toHaveLength(1)
  expect(JSON.parse(sent[0])).toEqual({ new_email: newEmail })
})
