import { fileURLToPath } from 'node:url'
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { signUpUser } from '../support/api'
import { chooseFromDropdown, leaveImportSetup, logInViaApi, openPage, showImportSetup } from '../support/app'
import { measureFit, measureOwnScroll } from '../support/layout'

// Runs on desktop only: it sets the window sizes it checks itself

/**
 * Guards the Firefly III and Actual Budget budget tables against text that wraps. They keep their
 * desktop layout at every width: where the box around a table is too narrow for its columns, the table
 * scrolls sideways inside that box, the page never does, and no header or cell breaks onto a second line
 *
 * It has no German run: the dates are ISO strings from the export in every language, and the layout
 * depends on the width of its content, not on the language's wording
 */

// The sizes at which the table fits its area: a wide desktop and the common narrow desktop
const FITTING_SIZES = [{ width: 1920, height: 1080 }, { width: 1280, height: 800 }]

// A tablet and a phone, where the table scrolls sideways inside its own box
const SCROLLING_SIZES = [{ width: 768, height: 1024 }, { width: 390, height: 844 }]

const FIREFLY_FILES = ['transactions.csv', 'budgets.csv', 'accounts.csv']
  .map((name) => fileURLToPath(new URL(`../fixtures/firefly-export/${name}`, import.meta.url)))
const ACTUAL_FILE = fileURLToPath(new URL('../fixtures/actual-yen/export.zip', import.meta.url))

// The archived budget in the Firefly III export
const ARCHIVED_BUDGET_CHECKBOX = 'Import Retired'

// Soft, so a run on a broken table reports every size rather than stopping at the first
const soft = expect.configure({ soft: true })

/** The budgets a step offers, as the table */
function budgetsOf(page: Page) {
  return page.locator('table').filter({ has: page.getByRole('checkbox', { name: /^Import / }) })
}

/** How many pieces of text sit in the headers and cells of `budgets`, and which of them break over lines */
function measureWrapping(budgets: Locator) {
  return budgets.evaluate((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    let found = 0
    const wrapped: string[] = []
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(text)
      const lines = range.getClientRects().length
      if (lines === 0) continue
      found += 1
      if (lines > 1) wrapped.push(text.textContent.trim())
    }
    return { found, wrapped }
  })
}

async function expectNothingToWrap(budgets: Locator, label: string, width: number) {
  await soft.poll(async () => {
    const { found, wrapped } = await measureWrapping(budgets)
    return found > 0 ? wrapped : ['no text found']
  }, { message: `${label} text wrapping at ${width}px` }).toEqual([])
}

async function expectBudgetsToFit(page: Page, label: string) {
  const budgets = budgetsOf(page)
  await expect(budgets).toBeVisible()
  for (const size of FITTING_SIZES) {
    await page.setViewportSize(size)
    await soft.poll(() => measureFit(budgets), { message: `${label} at ${size.width}px` }).toEqual({ scrolling: [], clipped: [] })
    await expectNothingToWrap(budgets, label, size.width)
  }
}

async function expectBudgetsToScroll(page: Page, label: string) {
  const budgets = budgetsOf(page)
  await expect(budgets).toBeVisible()
  for (const size of SCROLLING_SIZES) {
    await page.setViewportSize(size)
    // The box right around the table scrolls, and nothing past it, up to the page
    await soft.poll(() => measureOwnScroll(budgets), { message: `${label} at ${size.width}px` }).toEqual({ scrolls: true, outside: [] })
    await expectNothingToWrap(budgets, label, size.width)
  }
}

/** Signs up a fresh user and stages the Firefly III export, ending on the step that offers the budgets */
async function openFireflyBudgets(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data source', /^Firefly III/)
  const uploads = page.locator('input[type="file"][accept=".csv,text/csv"]')
  for (const [index, file] of FIREFLY_FILES.entries()) {
    await expect(uploads.nth(index)).toBeEnabled()
    await uploads.nth(index).setInputFiles(file)
    if (index === FIREFLY_FILES.length - 1) await showImportSetup(page)
    await expect(page.getByText(file.split('/').at(-1)!, { exact: true })).toBeVisible()
  }
  await leaveImportSetup(page)
}

async function openActualBudgets(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data source', 'Actual Budget')
  const upload = page.locator('input[type="file"][accept=".zip,.sqlite,application/zip"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles(ACTUAL_FILE)
}

test('fits the Firefly III budget table on a desktop without scrolling or wrapping', async ({ page, request }) => {
  await openFireflyBudgets(page, request)

  await expectBudgetsToFit(page, 'Firefly III budgets')
})

test('scrolls the Firefly III budget table sideways on a tablet and a phone, without wrapping', async ({ page, request }) => {
  await openFireflyBudgets(page, request)

  await expectBudgetsToScroll(page, 'Firefly III budgets')
})

test('shows an archived budget with its worded tag at every width', async ({ page, request }) => {
  await openFireflyBudgets(page, request)
  const row = budgetsOf(page).getByRole('row').filter({ has: page.getByRole('checkbox', { name: ARCHIVED_BUDGET_CHECKBOX }) })

  for (const size of [...FITTING_SIZES, ...SCROLLING_SIZES]) {
    await page.setViewportSize(size)
    await soft(row.getByText('Archived', { exact: true }), `the tag at ${size.width}px`).toBeVisible()
    await soft(row.getByRole('button', { name: 'Archived' }), `an icon-only tag at ${size.width}px`).toHaveCount(0)
  }
})

test('fits the Actual Budget budget table on a desktop without scrolling or wrapping', async ({ page, request }) => {
  await openActualBudgets(page, request)

  await expectBudgetsToFit(page, 'Actual Budget budgets')
})

test('scrolls the Actual Budget budget table sideways on a tablet and a phone, without wrapping', async ({ page, request }) => {
  await openActualBudgets(page, request)

  await expectBudgetsToScroll(page, 'Actual Budget budgets')
})
