import { expect, test, type Locator } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only: it sets the window sizes it checks itself

/**
 * Guards the skipped rows table against a reason that squeezes the file's columns or runs off the
 * box. Each reason is said once on a line of its own above its group of rows, so on a phone the
 * file's columns keep the room beside the frozen row number, wider up a long reason reads in a few
 * lines at the box's full width, and it holds still there when the file's columns are scrolled
 */

const WIDTHS = [1920, 1280, 768, 390]

// The second row names a day February doesn't have, which has a short reason. The third gives a dollar
// amount three decimal places, which has one of the longest. The two reasons differ, so each row is
// the only one in its group
const CSV = [
  'Date,Amount,Category,Merchant,Notes',
  '2024-03-15,-42.50,Groceries,Market,Weekly shop',
  '2024-02-31,-9.99,Groceries,Market,No such day',
  '2024-03-17,-1.234,Groceries,Market,Too precise',
].join('\n')

/** Whether the first file column's heading sits whole in the box, clear of the frozen row number */
function dateReadsInFull(table: Locator) {
  return table.evaluate((element) => {
    const scroller = element.parentElement!
    const box = scroller.getBoundingClientRect()
    const headings = [...element.querySelectorAll('th')]
    const lead = headings.find((th) => th.textContent === 'Row')!.getBoundingClientRect()
    const date = headings.find((th) => th.textContent === 'Date')!.getBoundingClientRect()
    return date.left >= lead.right - 1 && date.right <= box.left + scroller.clientLeft + scroller.clientWidth + 1
  })
}

test('keeps the skipped rows table readable at every width', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'skipped.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })
  await expect(page.getByText('2 rows will not be imported', { exact: true })).toBeVisible()

  const longReason = page.getByText(/^The amount has more decimal places than/)
  const table = page.getByRole('table').filter({ has: longReason })

  // Soft, so a run on a broken table reports every width rather than stopping at the first
  const softly = expect.configure({ soft: true })
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    // The whole date reads beside the row number, rather than sliding under it
    await softly.poll(async () => dateReadsInFull(table), { message: `date at ${width}px` }).toBe(true)

    // A long reason reads in a few lines of its own above its group
    if (width >= 768) {
      const lines = await longReason.evaluate((element) => {
        const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight)
        return Math.round(element.getBoundingClientRect().height / lineHeight)
      })
      expect.soft(lines, `reason lines at ${width}px`).toBeLessThanOrEqual(3)
    }

    // The reason holds still inside the box when the file's columns are scrolled to their end, rather
    // than running past its right edge with them
    const reasonFit = await table.evaluate((element, reason) => {
      const scroller = element.parentElement!
      scroller.scrollLeft = scroller.scrollWidth
      const box = scroller.getBoundingClientRect()
      const line = [...element.querySelectorAll('div, span')].find((node) => node.textContent === reason)!.getBoundingClientRect()
      const fits = line.left >= box.left - 1 && line.right <= box.left + scroller.clientWidth + 1
      scroller.scrollLeft = 0
      return fits
    }, (await longReason.textContent())!)
    expect.soft(reasonFit, `reason inside the box at ${width}px`).toBe(true)
  }
})
