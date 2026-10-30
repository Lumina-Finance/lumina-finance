import { test, type Page } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { checkSubmitTransition } from '../support/buttonFrames'

// Runs on desktop only, at the two widths set here, since the submit button sits in a grid below the sm
// breakpoint and in a row from it

const SIZES = [{ width: 390, height: 844 }, { width: 1280, height: 800 }]

const DIALOGS = [
  {
    // Delete's width class is `sm:w-auto`, so the width can't ease by CSS alone
    name: 'an auto-width dialog',
    label: 'Delete',
    request: { method: 'POST', path: '/transactions/bulk/delete' },
    open: async (page: Page, request: Parameters<typeof signUpUser>[0]) => {
      const user = await signUpUser(request)
      const account = await createAccount(request, user, { name: 'Everyday' })
      const date = daysFromTodayInTestTimezone(-1)
      await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date })
      await logInViaApi(page, user)
      await openPage(page, `/accounts/${account.id}`)
      await page.getByRole('button', { name: 'Select transactions', exact: true }).click()
      await page.getByRole('checkbox', { name: new RegExp(`^Select .+ on ${date}$`) }).check()
      await page.getByRole('button', { name: 'Delete the selected transactions', exact: true }).click()
      return page.getByRole('dialog', { name: 'Delete 1 transaction?', exact: true })
    },
  },
  {
    // Create's width class is `sm:w-28`, a fixed width that already eased by CSS
    name: 'a fixed-width dialog',
    label: 'Create',
    request: { method: 'POST', path: '/tags' },
    open: async (page: Page, request: Parameters<typeof signUpUser>[0]) => {
      const user = await signUpUser(request)
      await logInViaApi(page, user)
      await openPage(page, '/settings#tags')
      await page.locator('#tags').getByRole('button', { name: 'Create tag', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Create tag' })
      await dialog.getByRole('textbox', { name: 'Tag name', exact: true }).fill('Holiday')
      return dialog
    },
  },
]

for (const dialogCase of DIALOGS) {
  for (const size of SIZES) {
    test(`fades ${dialogCase.name}'s label and spinner and eases its button at ${size.width}px wide`, async ({ page, request }) => {
      await page.setViewportSize(size)
      const dialog = await dialogCase.open(page, request)
      const button = dialog.getByRole('button', { name: dialogCase.label, exact: true })
      await checkSubmitTransition(page, button, dialogCase.label, dialogCase.request)
    })
  }
}
