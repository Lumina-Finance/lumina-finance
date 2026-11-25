/**
 * Guards Delete profile at the bottom of Settings: the dialogue holds off until the user types delete,
 * the password confirms it, the app lands on the sign-in screen saying the profile is gone, and the
 * password no longer signs in. Where a waiting period applies, the dialogue and the sign-in screen name
 * the date, and the profile is held to a screen that cancels the deletion or signs out
 */
import { expect, test, type Page, type Route } from '@playwright/test'

import { daysFromTodayInTestTimezone, formatDateLabel, signUpUser } from '../support/api'
import { logInViaApi, openPage, waitForPageReady } from '../support/app'
import { checkSubmitTransition } from '../support/buttonFrames'
import { API_BASE_URL, BASE_URL } from '../support/target'

// Runs on desktop only: the section and its dialogue behave the same at every size

const DELETE_URL = `${API_BASE_URL}/auth/profile/delete`

/**
 * Answers the account's linked providers, as an account that signs in without a password has them
 */
async function stubIdentities(page: Page, providers: string[]) {
  await page.route(`${API_BASE_URL}/auth/oidc/identities`, (route) => route.fulfill({
    json: {
      has_password: false,
      identities: providers.map((slug) => ({
        id: `identity-${slug}`,
        provider_slug: slug,
        provider_display_name: slug,
        email: 'someone@example.com',
        created_at: new Date().toISOString(),
        last_login_at: null,
      })),
    },
  }))
}

test('deletes the profile once the user types delete and confirms with the password', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')

  await page.locator('#delete-profile').getByRole('button', { name: 'Delete profile', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete your profile and all your data?' })

  // Pressing Delete profile before typing the word only says what is missing
  await dialog.getByRole('button', { name: 'Delete profile', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Please type delete to confirm')
  // With no waiting period the warning stays as it was
  await expect(dialog.getByText('This will permanently delete all your data and is irrevocable.')).toBeVisible()

  await dialog.getByRole('textbox').fill('delete')
  await dialog.getByRole('button', { name: 'Delete profile', exact: true }).click()

  const stepUp = page.getByRole('dialog', { name: 'Delete profile' })
  await stepUp.getByLabel('Current password').fill(user.password)
  const deleted = page.waitForResponse((response) => response.url() === DELETE_URL && response.request().method() === 'POST')
  await stepUp.getByRole('button', { name: 'Delete profile', exact: true }).click()
  const answer = await deleted
  expect(answer.status()).toBe(200)
  expect(await answer.json()).toEqual({ deletion_due_at: null })

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('status').filter({ hasText: 'Your profile and data were deleted.' })).toBeVisible()

  // The message shows once, so reloading the sign-in screen drops it
  await page.reload()
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible()
  await expect(page.getByText('Your profile and data were deleted.')).toHaveCount(0)

  const signIn = await request.post(`${API_BASE_URL}/auth/login`, { data: { email: user.email, password: user.password } })
  expect(signIn.status()).toBe(401)
})

test('asks for the word again after the password step is closed', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')
  const open = page.locator('#delete-profile').getByRole('button', { name: 'Delete profile', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Delete your profile and all your data?' })

  await open.click()
  await dialog.getByRole('textbox').fill('delete')
  await dialog.getByRole('button', { name: 'Delete profile', exact: true }).click()
  const stepUp = page.getByRole('dialog', { name: 'Delete profile' })
  await expect(stepUp).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(stepUp).toBeHidden()

  await open.click()
  await expect(dialog.getByRole('textbox')).toHaveValue('')
})

test('holds the deletion until the export the dialogue started has finished', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/me/export', async (route) => {
    await held
    await route.continue()
  })

  await page.locator('#delete-profile').getByRole('button', { name: 'Delete profile', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete your profile and all your data?' })
  await dialog.getByRole('button', { name: 'Export all data' }).click()
  await dialog.getByRole('textbox').fill('delete')
  const confirm = dialog.getByRole('button', { name: 'Delete profile', exact: true })
  await expect(confirm).toHaveAttribute('aria-disabled', 'true')
  // Forced, since the button says it is unavailable and a plain click would wait for it to be enabled
  await confirm.click({ force: true })
  await confirm.focus()
  await page.keyboard.press('Enter')
  // Enter in the field asks to confirm as the button would, and is held off the same way
  await dialog.getByRole('textbox').press('Enter')
  const stepUp = page.getByRole('dialog', { name: 'Delete profile' })
  await expect(stepUp).toBeHidden()
  await expect(dialog).toBeVisible()

  const downloaded = page.waitForEvent('download')
  release()
  await downloaded
  await confirm.click()
  await expect(stepUp).toBeVisible()
})

test('warns about the bank sync provider charges for a user with a connection where new banks cannot be linked', async ({ page, request }) => {
  const user = await signUpUser(request)
  // No provider is offered, so Settings has no bank section of its own to load the connections
  await page.route(`${API_BASE_URL}/bank-sync/providers`, (route) => route.fulfill({ json: { may_link: true, sync_running: true, providers: [] } }))
  // Answered here in place of a connection kept from when a provider was offered
  await page.route(`${API_BASE_URL}/bank-sync/connections`, (route) => route.fulfill({ json: [{ id: 'connection-1' }] }))
  await logInViaApi(page, user)
  await openPage(page, '/settings')
  await expect(page.locator('#bank-connections')).toHaveCount(0)

  await page.locator('#delete-profile').getByRole('button', { name: 'Delete profile', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete your profile and all your data?' })
  await expect(dialog.getByText('Your subscriptions and related charges with the bank sync provider will not be cancelled automatically.', { exact: false })).toBeVisible()
})

test('shows the deletion under way when it returns from the provider sign-in', async ({ page, request }) => {
  const user = await signUpUser(request)
  await stubIdentities(page, ['stub-provider'])
  // The reauth is stubbed end to end, with the provider's page replaced by its return to the app
  await page.route(`${API_BASE_URL}/auth/oidc/reauth`, (route) => route.fulfill({
    json: { authorization_url: `${BASE_URL}/auth/oidc/callback?code=stub-code&state=stub-state` },
  }))
  await page.route(`${API_BASE_URL}/auth/oidc/reauth/callback`, (route) => route.fulfill({ status: 204 }))
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route(DELETE_URL, async (route) => {
    await held
    await route.fulfill({ json: { deletion_due_at: null } })
  })
  await logInViaApi(page, user)
  await openPage(page, '/settings')

  await page.locator('#delete-profile').getByRole('button', { name: 'Delete profile', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete your profile and all your data?' })
  await dialog.getByRole('textbox').fill('delete')
  await dialog.getByRole('button', { name: 'Delete profile', exact: true }).click()

  const pending = page.locator('#delete-profile').getByRole('button', { name: 'Deleting profile', exact: true })
  await expect(pending).toHaveAttribute('aria-busy', 'true')
  release()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('status').filter({ hasText: 'Your profile and data were deleted.' })).toBeVisible()
})

const CANCEL_URL = `${API_BASE_URL}/auth/profile/delete/cancel`
// Any length does, since the server answers it and the suite never sets one
const STUBBED_WAIT_DAYS = 21
const STUBBED_WAIT_SECONDS = STUBBED_WAIT_DAYS * 24 * 60 * 60

/**
 * Answers the account's linked providers with a waiting period added to the real answer
 */
async function stubDeletionWait(page: Page, waitSeconds: number) {
  await page.route(`${API_BASE_URL}/auth/oidc/identities`, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    body.profile_deletion_wait_seconds = waitSeconds
    await route.fulfill({ response, json: body })
  })
}

/**
 * Marks the signed-in user as waiting for a deletion due in the given number of days, on every refresh
 * answer until the test sets `waiting` to false, and keeps the user the app last received for the cancel
 * route to answer with
 *
 * @returns The due day as the app writes it, such as Oct 5, 2026, and the state the test reads and sets
 */
async function stubScheduledDeletion(page: Page, days: number) {
  const state: { waiting: boolean; lastUser: Record<string, unknown> | null } = { waiting: true, lastUser: null }
  // Midday in Toronto, so the due time falls on the same day wherever the suite runs
  const day = daysFromTodayInTestTimezone(days)
  const dueAt = `${day}T17:00:00Z`
  const hold = async (route: Route) => {
    const response = await route.fetch()
    const body = await response.json()
    body.user.deletion_due_at = state.waiting ? dueAt : null
    state.lastUser = body.user
    await route.fulfill({ response, json: body })
  }
  await page.route(`${API_BASE_URL}/auth/refresh`, hold)
  return { dueLabel: formatDateLabel(day), state }
}

test('names the date a waiting deletion runs in the dialogue and on the sign-in screen', async ({ page, request }) => {
  const user = await signUpUser(request)
  await stubDeletionWait(page, STUBBED_WAIT_SECONDS)
  const day = daysFromTodayInTestTimezone(STUBBED_WAIT_DAYS)
  const date = formatDateLabel(day)
  // The sign-in screen names the time the server scheduled. The suite's own server has no wait set, so it is answered here
  await page.route(DELETE_URL, (route) => route.fulfill({ json: { deletion_due_at: `${day}T17:00:00Z` } }))
  await logInViaApi(page, user)
  await openPage(page, '/settings')

  await page.locator('#delete-profile').getByRole('button', { name: 'Delete profile', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete your profile and all your data?' })
  await expect(dialog.getByText(`Your profile and data will be deleted on ${date}. Until then, you can sign in and cancel.`)).toBeVisible()
  await expect(dialog.getByText('This will permanently delete all your data and is irrevocable.')).toHaveCount(0)

  await dialog.getByRole('textbox').fill('delete')
  await dialog.getByRole('button', { name: 'Delete profile', exact: true }).click()
  const stepUp = page.getByRole('dialog', { name: 'Delete profile' })
  await stepUp.getByLabel('Current password').fill(user.password)
  await stepUp.getByRole('button', { name: 'Delete profile', exact: true }).click()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('status').filter({ hasText: `Your profile will be deleted on ${date}. Please sign in and cancel before then.` })).toBeVisible()
  await expect(page.getByText('Your profile and data were deleted.')).toHaveCount(0)
})

test('holds a profile waiting to be deleted to the cancel screen, and cancelling returns the app', async ({ page, request }) => {
  const user = await signUpUser(request)
  const { dueLabel, state } = await stubScheduledDeletion(page, STUBBED_WAIT_DAYS)
  await page.route(CANCEL_URL, async (route) => {
    state.waiting = false
    await route.fulfill({ json: { ...state.lastUser, deletion_due_at: null } })
  })
  await logInViaApi(page, user)
  await page.goto('/')

  await test.step('shows only the date, Cancel deletion and Sign out', async () => {
    await expect(page.getByRole('heading', { name: 'Your profile is scheduled for deletion' })).toBeVisible()
    await expect(page.getByText(`Your profile and data will be deleted on ${dueLabel}.`)).toBeVisible()
    await expect(page.getByRole('button')).toHaveText(['Cancel deletion', 'Sign out'])
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0)
    await expect(page.getByRole('main')).toHaveCount(0)
  })

  await test.step('cancelling shows the toast and brings the app back', async () => {
    await page.getByRole('button', { name: 'Cancel deletion', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Deletion cancelled' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your profile is scheduled for deletion' })).toHaveCount(0)
    await waitForPageReady(page)
  })
})

test('fades Cancel deletion to its spinner while the cancel runs, and back when it fails', async ({ page, request }) => {
  const user = await signUpUser(request)
  await stubScheduledDeletion(page, STUBBED_WAIT_DAYS)
  await logInViaApi(page, user)
  await page.goto('/')

  const button = page.getByRole('button', { name: 'Cancel deletion', exact: true })
  await checkSubmitTransition(page, button, 'Cancel deletion', { method: 'POST', path: '/auth/profile/delete/cancel' })
})

test('signs out from the cancel screen', async ({ page, request }) => {
  const user = await signUpUser(request)
  await stubScheduledDeletion(page, STUBBED_WAIT_DAYS)
  await logInViaApi(page, user)
  await page.goto('/')

  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible()
})

test('shows why a cancel that came too late failed and signs the user out', async ({ page, request }) => {
  const user = await signUpUser(request)
  await stubScheduledDeletion(page, STUBBED_WAIT_DAYS)
  // The server's own answer to a cancel made after the due time
  const detail = 'Your profile is already being deleted, so the deletion can no longer be cancelled'
  await page.route(CANCEL_URL, (route) => route.fulfill({ status: 409, json: { detail } }))
  await logInViaApi(page, user)
  await page.goto('/')

  await page.getByRole('button', { name: 'Cancel deletion', exact: true }).click()
  await expect(page.getByText(detail)).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})
