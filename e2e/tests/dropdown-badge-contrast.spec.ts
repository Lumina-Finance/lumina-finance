import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { faintestText } from '../support/contrast'
import { openFilters, selectFacet } from '../support/filters'

// Runs on desktop only: the specs set the one phone width they need, and the facet dropdown shows below 750px

/**
 * Guards the contrast of the count and status pills beside a dropdown option, on a row at rest and on a
 * row the pointer or the arrow keys rest on, chosen or not. The pill's bronze text sat under 4.5:1 on
 * the darker surface a highlighted row gives it in the light theme
 */

async function expectPillReadable(pill: Locator, label: string) {
  await expect(pill, `shows ${label}`).toBeVisible()
  const faintest = await faintestText(pill)
  expect.soft(faintest.contrast, `"${faintest.text}" ${label}`).toBeGreaterThanOrEqual(4.5)
}

async function expectHighlighted(option: Locator, isHighlighted: boolean) {
  await expect(option).toHaveClass(isHighlighted ? /app-dropdown-row-highlighted/ : /^(?!.*app-dropdown-row-highlighted)/)
}

async function openFacetDropdown(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  await createAccount(request, user, { name: 'Savings' })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  // The dropdown stands in for the facet tabs at this width. Two accounts and one category give the
  // Accounts row a count of 2 and the Category row, the chosen one, a count of 1
  const panel = await openFilters(page, 'Transaction')
  await selectFacet(page, panel, 'Accounts')
  await panel.getByRole('checkbox', { name: 'Everyday', exact: true }).click()
  await panel.getByRole('checkbox', { name: 'Savings', exact: true }).click()
  await selectFacet(page, panel, 'Category')
  await panel.getByRole('checkbox').first().click()
  return panel
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`in the ${colorScheme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    })

    test('draws a facet\'s count at full contrast on every kind of row', async ({ page, request }) => {
      const panel = await openFacetDropdown(page, request)
      await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)

      const field = panel.getByRole('combobox', { name: 'Filters', exact: true })
      await expectPillReadable(field.getByText('1', { exact: true }), 'in the closed field')
      await field.click()
      const chosen = page.getByRole('option', { name: /^Category/ })
      const other = page.getByRole('option', { name: /^Accounts/ })

      // The list opens with the keyboard cursor on the chosen row
      await expectHighlighted(chosen, true)
      await expectPillReadable(chosen.getByText('1', { exact: true }), 'on the chosen row while highlighted')
      await other.hover()
      await expectHighlighted(other, true)
      await expectPillReadable(other.getByText('2', { exact: true }), 'on a row under the pointer')

      // The cursor left the chosen row, which is now at rest
      await expectHighlighted(chosen, false)
      await expectPillReadable(chosen.getByText('1', { exact: true }), 'on the chosen row at rest')
      await chosen.hover()
      await expectHighlighted(other, false)
      await expectPillReadable(other.getByText('2', { exact: true }), 'on a row at rest')
    })

    test('draws the "Does not fit" status at full contrast on every kind of row', async ({ page, request }) => {
      const user = await signUpUser(request)
      const account = await createAccount(request, user, { name: 'Everyday' })
      await logInViaApi(page, user)
      await openPage(page, `/settings/imports?account=${account.id}`)
      const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
      await expect(upload).toBeEnabled()

      // No date format reads these dates, so every format in the Date format dropdown is marked
      const csv = ['Date,Amount', '2024-13-45,"1,234"', '99/99/2024,5.678'].join('\n')
      await upload.setInputFiles({ name: 'dates.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
      await page.getByRole('combobox', { name: 'Match to app field Date', exact: true }).click()
      await page.getByRole('option', { name: /^Date\b/ }).click()
      await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)

      await page.getByRole('combobox', { name: 'Date format', exact: true }).click()
      const rows = page.getByRole('option').filter({ hasText: 'Does not fit' })
      const hovered = rows.nth(1)
      const resting = rows.nth(2)
      await hovered.hover()
      await expectHighlighted(hovered, true)
      await expectPillReadable(hovered.getByText('Does not fit', { exact: true }), 'on a row under the pointer')
      await expectHighlighted(resting, false)
      await expectPillReadable(resting.getByText('Does not fit', { exact: true }), 'on a row at rest')

      // A chosen format shows the same status in the closed field
      await hovered.click()
      const field = page.getByRole('combobox', { name: 'Date format', exact: true })
      await expectPillReadable(field.getByText('Does not fit', { exact: true }), 'in the closed field')
    })
  })
}
