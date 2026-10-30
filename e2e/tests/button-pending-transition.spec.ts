import { test, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openModal, openPage, reachTwoFactorChallenge } from '../support/app'
import { checkSubmitTransition } from '../support/buttonFrames'
import { enrollTotp } from '../support/totp'

// Runs at 390px and 1280px wide, both set here. Each case is one kind of button that turns into a spinner
// while its request is in flight: a transaction dialogue footer, a budget one, an account one, the
// second-factor step and the sign-in page. The settings lists and dialogues are in
// settings-pending-transition.spec.ts, and a source sweep in tests/lint/pendingContentSwap.test.ts covers the rest

const SIZES = [{ width: 390, height: 844 }, { width: 1280, height: 800 }]

type Request = Parameters<typeof signUpUser>[0]

interface Case {
  name: string
  label: string
  request: { method: string; path: (user: TestUser) => string }
  open: (page: Page, request: Request, user: TestUser) => Promise<{ button: Locator; press?: () => Promise<void> }>
}

const CASES: Case[] = [
  {
    name: 'the transaction dialogue footer',
    label: 'Save',
    request: { method: 'PATCH', path: () => '/transactions/*' },
    open: async (page, request, user) => {
      const account = await createAccount(request, user, { name: 'Action account' })
      const id = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -4250 })
      await logInViaApi(page, user)
      await openPage(page, '/transactions')
      await page.getByTestId(`transaction-row-${id}`).click()
      const dialog = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
      await dialog.getByLabel('Amount').fill('43.50')
      return { button: dialog.getByTestId('transaction-submit') }
    },
  },
  {
    name: 'the budget dialogue footer',
    label: 'Create budget',
    request: { method: 'POST', path: () => '/base-budgets' },
    open: async (page, _request, user) => {
      await logInViaApi(page, user)
      await openPage(page, '/budgets')
      const dialog = await openModal(page, ['New budget'], 'Add budget')
      await dialog.getByLabel('Name', { exact: true }).fill('Pending budget')
      await dialog.getByLabel('Limit', { exact: true }).fill('500')
      await dialog.getByRole('button', { name: 'Groceries', exact: true }).click()
      return { button: dialog.getByTestId('budget-submit') }
    },
  },
  {
    name: 'the account dialogue footer',
    label: 'Save changes',
    request: { method: 'PATCH', path: () => '/accounts/*' },
    open: async (page, request, user) => {
      const account = await createAccount(request, user, { name: 'Everyday' })
      await logInViaApi(page, user)
      await openPage(page, `/accounts/${account.id}`)
      await page.getByRole('button', { name: 'Edit account', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
      await dialog.getByRole('textbox', { name: 'Account name', exact: true }).fill('Renamed')
      return { button: dialog.getByRole('button', { name: 'Save changes', exact: true }) }
    },
  },
  {
    name: 'the sign-in page',
    label: 'Log in',
    request: { method: 'POST', path: () => '/auth/login' },
    open: async (page, _request, user) => {
      await page.goto('/login')
      await page.getByLabel('Email').fill(user.email)
      await page.getByLabel('Password', { exact: true }).fill('not-the-password')
      return { button: page.getByRole('button', { name: 'Log in', exact: true }) }
    },
  },
]

for (const kind of CASES) {
  for (const size of SIZES) {
    test(`fades ${kind.name}'s label and spinner and eases its button at ${size.width}px wide`, async ({ page, request }) => {
      await page.setViewportSize(size)
      const user = await signUpUser(request)
      const { button, press } = await kind.open(page, request, user)
      await checkSubmitTransition(page, button, kind.label, { method: kind.request.method, path: kind.request.path(user) }, press)
    })
  }
}

for (const size of SIZES) {
  test(`fades the second-factor step's label and spinner and eases its button at ${size.width}px wide`, async ({ page, request }) => {
    await page.setViewportSize(size)
    const user = await signUpUser(request)
    await enrollTotp(request, user)
    // A refused code spends the challenge and sends the user back to log in, so the button has no way back
    // to check, and each round of motion reaches a fresh challenge
    for (const motion of ['no-preference', 'reduce'] as const) {
      await reachTwoFactorChallenge(page, user)
      const verify = page.getByRole('button', { name: 'Verify', exact: true })
      // A full code submits itself as its last digit is typed
      const press = () => page.getByLabel('One-time code').pressSequentially('000000')
      await checkSubmitTransition(page, verify, 'Verify', { method: 'POST', path: '/auth/2fa/verify' }, press, {
        returns: false,
        motions: [motion],
      })
    }
  })
}
