import { expect, test, type Page } from '@playwright/test'

import { signUpUser } from '../support/api'
import { chooseFromDropdown, commitImport, logInViaApi, openPage } from '../support/app'
import { statementFile, type StatementTransaction } from '../support/ofx'

// Runs on desktop only, setting each width itself, since every width is checked from one project

const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]

const transaction = (fitId: string, posted: string, name: string): StatementTransaction => ({ posted, amount: '-5.00', fitId, name })

// Three files share a name, and the second and third repeat transactions the files before them hold
const FILES = [
  statementFile('sep-2026.qfx', [transaction('S1', '20260901120000', 'Bakery')]),
  statementFile('oct-2026.qfx', [transaction('O1', '20261001120000', 'Market')]),
  statementFile('statement.qfx', [transaction('A1', '20260928120000', 'Cafe')]),
  statementFile('statement.qfx', [transaction('A1', '20260928120000', 'Cafe'), transaction('A2', '20260930120000', 'Hardware')]),
  statementFile('statement.qfx', [transaction('A2', '20260930120000', 'Hardware'), transaction('A3', '20261002120000', 'Gas')]),
]

async function stageFiles(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size)
  const user = await signUpUser(page.context().request)
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data source', 'OFX/QFX')
  const upload = page.locator('input[type="file"][accept*=".ofx"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles(FILES)
  await expect(page.getByRole('button', { name: 'Remove statement.qfx (file 5)', exact: true })).toBeVisible()
}

for (const size of SIZES) {
  test(`shows every staged file above the upload card at ${size.width}px`, async ({ page }) => {
    await stageFiles(page, size)

    const result = await page.evaluate(() => {
      const removes = Array.from(document.querySelectorAll('button[aria-label^="Remove "]'))
      const card = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Add more statements'))
      const last = removes[removes.length - 1].getBoundingClientRect()

      // Whether a scrolling box between a file's button and its section could hold the file out of sight
      const scrollers = removes.filter((button) => {
        for (let node = button.parentElement; node && node.tagName !== 'SECTION'; node = node.parentElement) {
          if (/auto|scroll/.test(getComputedStyle(node).overflowY)) return true
        }
        return false
      })
      return { count: removes.length, scrolled: scrollers.length, lastBottom: last.bottom, cardTop: card!.getBoundingClientRect().top }
    })

    expect(result.count).toBe(5)
    expect(result.scrolled).toBe(0)
    expect(result.cardTop).toBeGreaterThanOrEqual(result.lastBottom)
  })
}

test('lines the data source dropdown up with the staged files and the upload card at 1280px', async ({ page }) => {
  await stageFiles(page, SIZES[1])

  const edges = await page.evaluate(() => {
    const rightOf = (element: Element | null | undefined) => element!.getBoundingClientRect().right
    const card = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Add more statements'))
    return {
      dropdown: rightOf(document.querySelector('.app-dropdown-glass')),
      list: rightOf(document.querySelector('button[aria-label^="Remove "]')?.closest('section')),
      card: rightOf(card),
    }
  })

  expect(edges.dropdown).toBeCloseTo(edges.card, 0)
  expect(edges.list).toBeCloseTo(edges.card, 0)
})

for (const size of [SIZES[0], SIZES[1], SIZES[3]]) {
  test(`shows a skipped transaction's whole date at ${size.width}px, labelled with its file`, async ({ page }) => {
    await stageFiles(page, size)

    const skipped = page.locator('td').getByText('September 28, 2026', { exact: true })
    await expect(skipped).toBeVisible()
    const isCut = await skipped.evaluate((date) => {
      const cell = date.closest('.truncate')!
      return cell.scrollWidth > cell.clientWidth + 1
    })
    expect(isCut).toBe(false)

    // The reason names the file the way a row in the staged list does
    await expect(page.getByText('This transaction is already in statement.qfx (file 3).', { exact: true })).toBeVisible()
    // The staged list names the file too, but sits in the setup panel, which is collapsed at wide sizes
    await expect(page.locator('td', { hasText: 'September 28, 2026' }).getByText('statement.qfx (file 4)', { exact: true })).toBeVisible()
  })
}

test('names files of one name by their position in the last import and its undo dialog', async ({ page }) => {
  await stageFiles(page, SIZES[0])
  expect((await commitImport(page)).status()).toBe(201)

  await openPage(page, '/settings/imports')
  const label = 'sep-2026.qfx, oct-2026.qfx, statement.qfx (file 3), statement.qfx (file 4), statement.qfx (file 5)'
  await expect(page.getByRole('region', { name: 'Last import' })).toContainText(label)
  await page.getByRole('button', { name: `Undo import of ${label}`, exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Undo this import?' })).toContainText(`everything ${label} added`)
})
