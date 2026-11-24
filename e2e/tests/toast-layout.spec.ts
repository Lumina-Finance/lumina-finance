import { expect, test, type Locator, type Page } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only: it sets the phone and desktop widths it checks itself

const SIZES = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]

// The export failing is a message the page shows with nothing else in the way, and the server's
// answer picks how long it is
const LONG_FAILURE = 'Oops, something went wrong and nothing was downloaded. Please try again.'
const SHORT_FAILURE = 'Nothing was downloaded: gone'

/** Fails the export with the given answer and presses Export all data, from the compact menu on a phone */
async function failExport(page: Page, answer: { status: number; body: string }) {
  await page.unroute('**/me/export')
  await page.route('**/me/export', (route) => route.fulfill({ ...answer, contentType: 'application/json' }))
  const menuToggle = page.locator('[aria-controls="settings-mobile-section-menu"]')
  const menu = page.locator('#settings-mobile-section-menu')
  const isPhone = await menuToggle.isVisible()
  if (isPhone && !(await menu.isVisible())) await menuToggle.click()
  await (isPhone ? menu : page.locator('body')).getByRole('button', { name: 'Export all data', exact: true }).click()
}

/** Where the message's parts sit, measured in the page */
function measure(message: Locator) {
  return message.evaluate((card) => {
    const middle = (box: DOMRect) => (box.top + box.bottom) / 2
    const icon = card.querySelector('svg')!.parentElement!
    const close = card.querySelector('button')!
    const text = [...card.children].find((child) => child !== icon && child !== close) as HTMLElement
    const style = getComputedStyle(text)
    const lineHeight = parseFloat(style.lineHeight)
    const textBox = text.getBoundingClientRect()
    const lineRects = (() => {
      const range = document.createRange()
      range.selectNodeContents(text)
      return [...range.getClientRects()].filter((rect) => rect.width > 0)
    })()
    const lastLine = Math.max(...lineRects.map((rect) => rect.bottom))

    // The words whose boxes end on the last line
    const node = text.firstChild as Text
    let offset = 0
    let wordsOnLastLine = 0
    for (const word of node.data.trim().split(/\s+/)) {
      const start = node.data.indexOf(word, offset)
      offset = start + word.length
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, offset)
      if (Math.abs(range.getBoundingClientRect().bottom - lastLine) < 2) wordsOnLastLine += 1
    }

    return {
      lineHeight,
      lines: Math.round((textBox.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / lineHeight),
      textHeight: textBox.height,
      iconHeight: icon.getBoundingClientRect().height,
      closeMinusIcon: middle(close.getBoundingClientRect()) - middle(icon.getBoundingClientRect()),
      firstLineMinusIcon: textBox.top + parseFloat(style.paddingTop) + lineHeight / 2 - middle(icon.getBoundingClientRect()),
      wordsOnLastLine,
    }
  })
}

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    test.use({ viewport: size })

    test('sets a message that wraps as close as a callout, with its close on the icon\'s line and no word left alone', async ({ page, request }) => {
      const user = await signUpUser(request)
      await logInViaApi(page, user)
      await openPage(page, '/settings')

      await failExport(page, { status: 404, body: JSON.stringify({ detail: 'Gone' }) })
      const short = page.locator('body > [role="alert"]').filter({ hasText: SHORT_FAILURE })
      await expect(short).toBeVisible()
      const oneLine = await measure(short)
      await short.getByRole('button', { name: 'Dismiss message', exact: true }).click()
      await expect(short).toHaveCount(0)

      await failExport(page, { status: 500, body: '{}' })
      const long = page.locator('body > [role="alert"]').filter({ hasText: LONG_FAILURE })
      await expect(long).toBeVisible()
      const wrapped = await measure(long)

      // A one-line message is as tall as the icon
      expect(oneLine.lines).toBe(1)
      expect(oneLine.textHeight).toBeCloseTo(oneLine.iconHeight, 0)

      // A message that wraps has its lines 20px apart, its first line where a one-line message has it,
      // and at least two words on its last line
      expect(wrapped.lines).toBeGreaterThan(1)
      expect(wrapped.lineHeight).toBe(20)
      expect(wrapped.firstLineMinusIcon).toBeCloseTo(oneLine.firstLineMinusIcon, 0)
      expect(wrapped.wordsOnLastLine).toBeGreaterThan(1)

      // The close stays level with the icon whatever the message's length
      for (const reading of [oneLine, wrapped]) expect(Math.abs(reading.closeMinusIcon)).toBeLessThanOrEqual(0.5)
    })
  })
}
