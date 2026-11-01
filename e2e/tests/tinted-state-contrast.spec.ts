import { expect, test, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createMonthlyBudget, createTaxAdvantagedCategory, signUpUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openModal, openPage } from '../support/app'
import { colourContrast, faintestText } from '../support/contrast'
import { API_BASE_URL } from '../support/target'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs on desktop only, apart from the left-out column test, which runs at every size: import rows
// stack below 1050px

/**
 * Guards the contrast of text on the states that lay a tint over the surface under them: a field in error,
 * an open dropdown's highlighted and chosen rows, a row the import leaves out, the archive warning, the
 * budget details panel and a chosen or hovered tax-advantaged limit row. Each tint took the faint or muted
 * text on it below the 4.5:1 every text needs
 */

// One column the reader maps to Amount on its own, and one it maps to nothing and leaves out
const CSV = ['Date,Merchant,Amount,Batch', '2026-03-15,Kiosk,-12.00,B7'].join('\n')

async function expectReadable(area: Locator, label: string) {
  // Read until the area has come in, since text not yet on screen measures as nothing to read
  await expect.poll(async () => (await faintestText(area)).text, { message: label }).toMatch(/\S/)
  const faintest = await faintestText(area)
  expect(faintest.contrast, `"${faintest.text}" ${label}`).toBeGreaterThanOrEqual(4.5)
}

/**
 * Checks each faint text, every place it shows, after first making sure it shows at all, so a text that
 * never rendered can't pass by having nothing to read. Each is checked apart, so one that falls short
 * doesn't hide another
 */
async function expectFaintTextReadable(texts: Record<string, Locator>) {
  for (const [what, text] of Object.entries(texts)) {
    await expect(text.first(), `shows its ${what}`).toBeVisible()
    for (const each of await text.all()) {
      const faintest = await faintestText(each)
      expect.soft(faintest.contrast, `"${faintest.text}", its ${what}`).toBeGreaterThanOrEqual(4.5)
    }
  }
}

async function openImport(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'spending.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`in the ${colorScheme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    })

    async function expectTheme(page: Page) {
      await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
    }

    test('draws an open dropdown\'s highlighted and chosen rows at full contrast', async ({ page, request }) => {
      await openImport(page, request)
      await expectTheme(page)

      // The Amount column comes in mapped to Amount. Every option carries a hint under its label
      await page.getByRole('combobox', { name: /Amount$/ }).click()
      const chosen = page.getByRole('option', { selected: true })
      await expect(chosen).toBeVisible()

      // The list opens with the keyboard on the chosen row, and the next press moves it to the row after
      await expect(chosen).toHaveClass(/app-dropdown-row-highlighted/)
      await expectReadable(chosen, 'on the chosen row while highlighted')
      await page.keyboard.press('ArrowDown')
      await expect(chosen).not.toHaveClass(/app-dropdown-row-highlighted/)
      await expectReadable(chosen, 'on the chosen row')
      await expectReadable(page.locator('.app-dropdown-row-highlighted'), 'on a highlighted row')
    })

    test('draws a column the import leaves out at full contrast', AT_EVERY_SIZE, async ({ page, request }) => {
      await openImport(page, request)
      await expectTheme(page)
      await expectReadable(page.getByRole('row').filter({ hasText: 'Ignored' }), 'on the ignored column\'s row')
    })

    test('draws a money field in error at full contrast', async ({ page, request }) => {
      const user = await signUpUser(request)
      await createAccount(request, user, { name: 'Everyday' })
      await logInViaApi(page, user)
      await openPage(page, '/transactions')
      await expectTheme(page)
      const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
      // The field shows the currency symbol once an account gives it a currency
      await chooseFromDropdown(dialog, 'Account', 'Everyday')
      await dialog.getByTestId('transaction-submit').click()
      const amount = dialog.locator('#txn-amount')
      await expect(amount).toHaveClass(/app-input-error/)
      await expect(amount.locator('..').getByText('$', { exact: true })).toBeVisible()
      await expectReadable(amount.locator('..'), 'in the amount field')
    })

    test('draws the archive warning at full contrast', async ({ page, request }) => {
      const user = await signUpUser(request)
      const account = await createAccount(request, user, { name: 'Everyday' })
      await logInViaApi(page, user)
      await openPage(page, `/accounts/${account.id}`)
      await expectTheme(page)
      await page.getByRole('button', { name: 'Edit account', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
      await dialog.getByText('Archive account', { exact: true }).click()
      await expect(dialog.getByRole('switch')).toBeChecked()
      const heading = dialog.getByText('Balance will be set to zero', { exact: true })
      // The dialog scrolls the warning up from under its footer as it opens, so read it once its closing
      // sentence is in view
      await expect(dialog.getByText('no balance adjustment will be recorded', { exact: false })).toBeInViewport({ ratio: 1 })
      await expectReadable(heading.locator('xpath=../../..'), 'in the archive warning')
    })

    test('draws faint text on the budget details panel at full contrast', async ({ page, request }) => {
      const user = await signUpUser(request)
      await createMonthlyBudget(request, user, { name: 'Monthly Food', categoryNames: ['Groceries'], overallLimit: 50_000 })
      // A period with no category in its figures says so instead of listing them. The figures always list
      // the tracked categories, so they are answered without them, which puts that note on the panel too
      await page.route(/\/(budgets\/latest-utilizations|base-budgets\/[^/]+\/utilizations)(\?|$)/, async (route) => {
        const periods = await (await route.fetch()).json() as { categories: unknown[] }[]
        await route.fulfill({ json: periods.map((period) => ({ ...period, categories: [] })) })
      })
      await logInViaApi(page, user)
      await openPage(page, '/budgets')
      await expectTheme(page)
      await page.getByRole('button', { name: /Monthly Food/ }).click()
      const panel = page.getByRole('dialog', { name: 'Monthly Food', exact: true }).getByRole('complementary')
      // Each faint text the panel draws on its tint, read one by one since the panel's FX badge is drawn
      // in a colour of its own
      await expectFaintTextReadable({
        'cadence line': panel.getByText(/^Monthly · Personal · /),
        'Current budget label': panel.getByText('Current budget', { exact: true }),
        'share used': panel.getByText(/^\d+% used$/),
        'Current period label': panel.getByText('Current period', { exact: true }),
        'Tracked categories heading': panel.getByText('Tracked categories', { exact: true }),
        'note that nothing is spent': panel.getByText('No category spending for the current period.', { exact: true }),
      })
    })

    test('draws a hovered limit row\'s delete control at full contrast', async ({ page, request }) => {
      const user = await signUpUser(request)
      const categoryId = await createTaxAdvantagedCategory(request, user, 'Retirement Savings')
      for (const year of [2025, 2026]) {
        const limit = await request.post(`${API_BASE_URL}/tax-advantaged-categories/${categoryId}/limits`, {
          headers: asUser(user),
          data: { year, contribution_limit: 700000 },
        })
        expect(limit.status()).toBe(201)
      }
      await logInViaApi(page, user)
      await openPage(page, '/settings#tax-advantaged-categories')
      await expectTheme(page)
      await page.getByRole('row').filter({ hasText: 'Retirement Savings' }).click()
      const category = page.getByRole('dialog', { name: 'Retirement Savings', exact: true })

      // A hovered row lays the accent tint under its delete control. A chosen row lays the same tint, but
      // only while its year's dialog covers it, so the hovered row is where the control is read
      const remove = category.getByRole('button', { name: 'Delete 2026 limits', exact: true })
      await category.getByRole('row').filter({ hasText: '2026' }).hover()
      expect(await colourContrast(remove), 'a hovered row\'s delete control').toBeGreaterThanOrEqual(4.5)
    })

    test('draws a hovered limit card\'s chevron at full contrast on a phone', async ({ page, request }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      const user = await signUpUser(request)
      const categoryId = await createTaxAdvantagedCategory(request, user, 'Retirement Savings')
      const limit = await request.post(`${API_BASE_URL}/tax-advantaged-categories/${categoryId}/limits`, {
        headers: asUser(user),
        data: { year: 2026, contribution_limit: 700000 },
      })
      expect(limit.status()).toBe(201)
      await logInViaApi(page, user)
      await openPage(page, '/settings#tax-advantaged-categories')
      await expectTheme(page)
      await page.getByRole('row').filter({ hasText: 'Retirement Savings' }).click()
      const category = page.getByRole('dialog', { name: 'Retirement Savings', exact: true })

      // Below 750px each year is a card, whose chevron sits on the accent tint while the card is hovered
      const card = category.getByRole('button', { name: 'Edit 2026 limits', exact: true })
      await card.hover()
      expect(await colourContrast(card.locator('svg.lucide-chevron-right')), 'a hovered card\'s chevron').toBeGreaterThanOrEqual(4.5)
    })

    test('draws every active account row at full contrast and an archived one faded, at rest and under the pointer', async ({ page, request }) => {
      const user = await signUpUser(request)
      const planId = await createTaxAdvantagedCategory(request, user, 'Retirement Savings')
      const savings = await createAccount(request, user, { name: 'Rainy Day Savings', accountType: 'savings', startingBalance: 1_250_000 })
      const linked = await request.patch(`${API_BASE_URL}/accounts/${savings.id}`, { headers: asUser(user), data: { tax_advantaged_category_id: planId } })
      expect(linked.status()).toBe(200)
      const old = await createAccount(request, user, { name: 'Old Savings', accountType: 'savings', startingBalance: 90_000 })
      const archived = await request.patch(`${API_BASE_URL}/accounts/${old.id}`, { headers: asUser(user), data: { is_archived: true } })
      expect(archived.status()).toBe(200)
      const accounts = {
        'positive balance': await createAccount(request, user, { name: 'Everyday Checking', startingBalance: 440_000 }),
        'negative balance': await createAccount(request, user, { name: 'Overdrawn Chequing', startingBalance: -25_000 }),
        'zero balance': await createAccount(request, user, { name: 'Empty Wallet', startingBalance: 0 }),
        'linked plan': savings,
        'archived account': old,
      }
      await logInViaApi(page, user)
      await openPage(page, '/accounts')
      await expectTheme(page)
      // Archived accounts wait in a section of their own until it is opened
      if (!(await page.locator(`a[href="/accounts/${old.id}"]`).isVisible())) {
        await page.getByRole('button', { name: /Archived/ }).first().click()
      }

      // The row tints with the soft accent under the pointer, which took the green of a positive balance
      // from 4.52:1 to 4.03:1 and a linked plan's label to 3.84:1 in the light theme. An archived row stays
      // faded as a whole so it reads as unavailable, which is exempt from the 4.5:1 minimum
      for (const [what, account] of Object.entries(accounts)) {
        if (account === old) continue
        const row = page.locator(`a[href="/accounts/${account.id}"]`)
        await expect(row).toBeVisible()
        await page.mouse.move(0, 0)
        await expectReadable(row, `on a row with a ${what}`)
        await row.hover()
        await expectReadable(row, `on a row with a ${what} under the pointer`)
      }

      // An archived row keeps the fade it has on main, three quarters at rest and full under the pointer,
      // while an active row is never faded
      const archivedRow = page.locator(`a[href="/accounts/${old.id}"]`)
      const activeRow = page.locator(`a[href="/accounts/${accounts['positive balance'].id}"]`)
      const opacityOf = (row: Locator) => row.evaluate((node) => getComputedStyle(node).opacity)
      await page.mouse.move(0, 0)
      await expect.poll(() => opacityOf(archivedRow), { message: 'an archived row at rest' }).toBe('0.75')
      expect(await opacityOf(activeRow), 'an active row at rest').toBe('1')
      await archivedRow.hover()
      await expect.poll(() => opacityOf(archivedRow), { message: 'an archived row under the pointer' }).toBe('1')
    })
  })
}
