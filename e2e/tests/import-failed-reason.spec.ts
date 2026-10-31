import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only: it resizes the window itself to each width it checks

const COMMIT_URL = /\/transactions\/import\/runs\/[^/]+\/commit$/
const REASON = 'Withdrawal source is not an imported account'
const CSV = ['Date,Amount,Category,Merchant,Notes', '2024-03-15,-42.50,Groceries,Market,Weekly shop'].join('\n')

// Commits a file the server refuses, which leaves the failed import's overlay open
async function failImport(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)

  await page.route(COMMIT_URL, (route) => route.fulfill({ status: 422, json: { detail: REASON } }))
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'refused.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })
  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  await commit.click()

  return page.getByRole('dialog')
}

// At the largest text size the card is taller than a phone screen, so the overlay has to scroll
// for the message above it and the button below it to be reachable
test('keeps a failed import reachable on a phone at 200% text size', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const overlay = await failImport(page, request)
  const card = overlay.locator(':scope > div').first()
  const backToImport = overlay.getByRole('button', { name: 'Back to import', exact: true })
  await expect(backToImport).toBeVisible()

  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await expect.poll(async () => (await card.boundingBox())!.height).toBeGreaterThan(844)

  const scrollOverlayTo = (edge: 'top' | 'bottom') =>
    overlay.evaluate((element, to) => element.scrollTo(0, to === 'top' ? 0 : element.scrollHeight), edge)

  await scrollOverlayTo('bottom')
  const buttonBox = (await backToImport.boundingBox())!
  expect(buttonBox.y).toBeGreaterThanOrEqual(0)
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(844)

  await scrollOverlayTo('top')
  expect((await card.boundingBox())!.y).toBeGreaterThanOrEqual(0)
})

// The server's own reason is English while the note about what was saved is translated, so the two
// must not run together as one sentence, and the overlay's message and button must not narrow
test('shows the server\'s reason of a failed import on its own line at desktop and phone widths', async ({ page, request }) => {
  const overlay = await failImport(page, request)
  const message = overlay.locator('p:not([role="status"])').filter({ hasText: 'Nothing was added to your ledger.' })
  const reason = message.locator('span[lang="en"]')
  await expect(reason).toHaveText(`${REASON}.`)
  const backToImport = overlay.getByRole('button', { name: 'Back to import', exact: true })

  for (const size of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size)

    // The note starts below the reason's box, so the two never share a line
    const [reasonBox, noteTop] = await Promise.all([
      reason.boundingBox(),
      message.evaluate((paragraph) => {
        const range = document.createRange()
        range.setStartAfter(paragraph.querySelector('span[lang="en"]')!)
        range.setEndAfter(paragraph.lastChild!)
        return range.getBoundingClientRect().top
      }),
    ])
    expect(noteTop).toBeGreaterThanOrEqual(reasonBox!.y + reasonBox!.height - 1)

    // The reason fills the message, which on a phone fills the card's inner width, as wide as the button under it
    const messageBox = (await message.boundingBox())!
    expect(reasonBox!.width).toBeCloseTo(messageBox.width, 0)
    if (size.width === 390) {
      const cardInnerWidth = await overlay.locator(':scope > div').first().evaluate((card) => {
        const style = getComputedStyle(card)
        return card.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      })
      expect(messageBox.width).toBeCloseTo(cardInnerWidth, 0)
      expect((await backToImport.boundingBox())!.width).toBeCloseTo(cardInnerWidth, 0)
    }
  }
})
