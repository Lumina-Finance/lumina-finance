import { expect, test, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { measureFit } from '../support/layout'

// Runs on desktop only: it sets the window sizes it checks itself

/**
 * Guards the import preview against the fixed minimum width it held. Below 1300px the preview list
 * scrolled sideways inside its own box with every amount out of view
 */

const WIDTHS = [1920, 1280, 768, 390]

/** The step titled `title` */
function stepOf(page: Page, title: string) {
  return page.locator('section').filter({ has: page.getByText(title, { exact: true }) }).last()
}

test('shows every preview row\'s amount without scrolling sideways', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  const csv = ['Date,Amount,Category,Merchant', '2024-03-15,-42.50,Groceries,Corner Market', '2024-03-16,-17.25,Groceries,Bakery'].join('\n')
  await upload.setInputFiles({ name: 'preview.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  const preview = stepOf(page, 'Preview and Commit')
  await expect(preview.getByText(/42\.50/).first()).toBeVisible()

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => measureFit(preview), { message: `preview at ${width}px` }).toEqual({ scrolling: [], clipped: [] })
    // Brought into view from the step around the list, so the list's own box is never scrolled sideways to
    // reach an amount
    await preview.evaluate((step) => step.scrollIntoView({ block: 'start' }))
    for (const amount of [/42\.50/, /17\.25/]) {
      await expect(preview.getByText(amount).filter({ visible: true }), `${amount} at ${width}px`).toBeInViewport({ ratio: 1 })
    }
  }
})
