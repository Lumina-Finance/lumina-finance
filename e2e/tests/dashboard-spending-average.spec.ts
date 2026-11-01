import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, signUpUser, todayInTestTimezone } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only: the toggle is the same control at every size, and the layout is checked by the
// dashboard spec. Dates are worked out from today, since the widget's periods follow it

const NO_HISTORY = 'Needs one whole month of history before this one.'
const NAME = 'Compare with your average'
const KEPT_NAME = `${NAME}, kept on`

/** The date on the given day of the month a number of months from this one, as YYYY-MM-DD */
function dayOfMonthFromNow(monthsBack: number, day: number): string {
  const [year, month] = todayInTestTimezone().split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 - monthsBack, day)).toISOString().slice(0, 10)
}

/** Gives a new user income on the first of the third month back, then 300, 600 and 900 spent on the 2nd of the three months since */
async function seedThreeMonths(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 100_000, date: dayOfMonthFromNow(3, 1) })
  const spent = [30_000, 60_000, 90_000]
  for (const [index, amount] of spent.entries()) {
    await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -amount, date: dayOfMonthFromNow(3 - index, 2) })
  }
  await logInViaApi(page, user)
  return user
}

/** The spending comparison card and its average toggle */
function averageToggle(page: Page): Locator {
  return page.getByRole('button', { name: /^Compare with your average/ })
}

// Behaviour is checked through roles, names and attributes. A class locator stays only where the assertion is about a
// drawn part itself, which has no role: the tint (.app-hold-toggle-clip), the hold fill, the dot, the strike line, the
// word's box, and the time selector's option the tint is compared with. The card and the title are structural
// containers with no role, so they are found by their classes, and the hidden width copies are excluded by attribute

/** Reads a value until it has stayed the same for a moment, in place of waiting a fixed time for motion to end */
async function settledValue<T>(read: () => Promise<T>): Promise<T> {
  let last: string | undefined
  let steadySamples = 0
  let value!: T
  await expect
    .poll(async () => {
      value = await read()
      const key = JSON.stringify(value)
      steadySamples = key === last ? steadySamples + 1 : 0
      last = key
      return steadySamples >= 8
    }, { intervals: [100], timeout: 15_000 })
    .toBe(true)
  return value
}

/** The control's box once it has held still for a moment, since the card's body loads and settles in after the page opens, and a press during that can land on the old body */
async function stableBox(control: Locator) {
  // The mouse works in the viewport, and the toggle sits low enough on the dashboard to start below it
  await control.scrollIntoViewIfNeeded()
  let box = await control.boundingBox()
  let steadySamples = 0
  await expect
    .poll(async () => {
      const next = await control.boundingBox()
      steadySamples = JSON.stringify(next) === JSON.stringify(box) ? steadySamples + 1 : 0
      box = next
      return steadySamples >= 8
    }, { intervals: [100] })
    .toBe(true)
  if (!box) throw new Error('The control has no box')
  return box
}

/** Holds the pointer down on a control until the press counts as a long one, then lets go */
async function longPress(page: Page, control: Locator) {
  const box = await stableBox(control)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect(control).toHaveAttribute('data-pressing', 'true')
  await expect(control).toHaveAttribute('data-pressing', 'false', { timeout: 5_000 })
  await page.mouse.up()
}

test('shows the average of the earlier months, which a click turns on and off', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  const baseResponse = page.waitForResponse((r) => r.url().includes('/dashboard/spending-comparison') && r.url().includes('range=MTD'))
  await openPage(page, '/dashboard')
  // The base answer counts the periods the average covers and leaves the history to the average being on
  const base = await (await baseResponse).json()
  expect(base.average_periods).toBe(3)
  expect(base.average_counts).toEqual([])

  const toggle = averageToggle(page)
  const shape = toggle.locator('.app-hold-toggle-clip')
  const timePeriod = page.locator('.app-time-selector .app-segmented-option').first()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText('Last month', { exact: true })).toBeVisible()

  // Off, it is the word in the time selector's weight, with no tint and no border of its own
  await page.mouse.move(0, 0)
  await expect(toggle).toHaveText('AVG')
  await expect(toggle).toHaveCSS('font-weight', await timePeriod.evaluate((element) => getComputedStyle(element).fontWeight))
  await expect(toggle).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
  await expect(toggle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(shape).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const offColor = await toggle.evaluate((element) => getComputedStyle(element).color)

  const averageResponse = page.waitForResponse((r) => r.url().includes('/dashboard/spending-comparison') && r.url().includes('average=true'))
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Average month', { exact: true })).toBeVisible()
  await expect(page.getByText('Last month', { exact: true })).toHaveCount(0)
  // Three whole months count, the one holding no spending on the 1st included, and day 2 holds 300 + 600 + 900
  const body = await (await averageResponse).json()
  expect(body.average_counts[1]).toBe(3)
  expect(body.average_sums[1]).toBe(180_000)

  // On for this visit, only the text is lit and it is bold, with nothing drawn behind it and no dot yet
  await page.mouse.move(0, 0)
  await expect(toggle.locator('.app-hold-toggle-dot')).toHaveCSS('opacity', '0')
  await expect(toggle).toHaveCSS('font-weight', '700')
  await expect(toggle).not.toHaveCSS('color', offColor)
  await expect(toggle).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
  await expect(toggle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(shape).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

  // Under the pointer it is tinted as a time period is
  await toggle.hover()
  await expect(shape).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(toggle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText('Last month', { exact: true })).toBeVisible()
})

test('keeps the average on across a reload after a long press, and stops keeping it after another', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)

  // The press that keeps it does not also click it back off
  await longPress(page, toggle)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(toggle).toHaveAccessibleName(KEPT_NAME)

  // The progress fill is gone once the hold has completed
  await expect(toggle.locator('.app-hold-toggle-fill')).toHaveCSS('opacity', '0')

  // Kept, it is bold accent text with a dot before it and no fill or border
  await page.mouse.move(0, 0)
  const dot = toggle.locator('.app-hold-toggle-dot')
  await expect(dot).toHaveCSS('opacity', '1')
  // A 5px dot, 4px before the word
  await expect(dot).toHaveCSS('width', '5px')
  await expect(dot).toHaveCSS('height', '5px')
  // Settled, since the word eases back from a press for a moment after the hold ends
  await expect
    .poll(async () => {
      const [dotBox, wordBox] = await Promise.all([dot.boundingBox(), toggle.locator('.app-hold-toggle-label').boundingBox()])
      return Math.abs(wordBox!.x - (dotBox!.x + dotBox!.width) - 4)
    })
    .toBeLessThanOrEqual(0.5)
  await expect(toggle.locator('.app-hold-toggle-clip')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(toggle).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
  await expect(toggle).toHaveCSS('font-weight', '700')

  await page.reload()
  await expect(averageToggle(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(averageToggle(page)).toHaveAccessibleName(KEPT_NAME)

  // A click turns it off for this visit only
  await averageToggle(page).click()
  await expect(averageToggle(page)).toHaveAttribute('aria-pressed', 'false')
  // The dot marking the default stays while it is off for this visit
  await expect(averageToggle(page).locator('.app-hold-toggle-dot')).toHaveCSS('opacity', '1')
  await page.reload()
  await expect(averageToggle(page)).toHaveAttribute('aria-pressed', 'true')

  // Holding a kept toggle lets it go and leaves the visit as it is
  await longPress(page, averageToggle(page))
  await expect(averageToggle(page)).toHaveAccessibleName(NAME)
  await expect(averageToggle(page)).toHaveAttribute('aria-pressed', 'true')
  // Only the hold that stops the default takes the dot away
  await expect(averageToggle(page).locator('.app-hold-toggle-dot')).toHaveCSS('opacity', '0')
  await page.reload()
  await expect(averageToggle(page)).toHaveAttribute('aria-pressed', 'false')
})

test('crosses the word out when off, drawing the line across it and drawing it back when on', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)
  const label = toggle.locator('.app-hold-toggle-label')
  // How much of the word the line covers, from the left, and how far its middle sits from the middle of the capitals
  const strike = () =>
    toggle.evaluate((element) => {
      const label = element.querySelector('.app-hold-toggle-label') as HTMLElement
      const word = label.getBoundingClientRect()
      const line = element.querySelector('.app-hold-toggle-strike')!.getBoundingClientRect()
      const text = [...label.querySelectorAll('span')].flatMap((span) => [...span.childNodes]).find((node) => node.nodeType === Node.TEXT_NODE)!
      const range = document.createRange()
      range.selectNodeContents(text)
      const style = getComputedStyle(label)
      const context = document.createElement('canvas').getContext('2d')!
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const baseline = range.getBoundingClientRect().bottom - context.measureText('x').fontBoundingBoxDescent
      const capMiddle = baseline - context.measureText('A').actualBoundingBoxAscent / 2
      return {
        covered: Number((line.width / word.width).toFixed(2)),
        left: Number((line.left - word.left).toFixed(1)),
        offCapMiddle: Number(Math.abs(line.top + line.height / 2 - capMiddle).toFixed(2)),
        thickness: Number(line.height.toFixed(1)),
      }
    })

  // Off, the line runs the whole word through the middle of its capitals, as a shape and not as text decoration
  await page.mouse.move(0, 0)
  await stableBox(toggle)
  await expect.poll(strike).toMatchObject({ covered: 1, left: 0, thickness: 2 })
  expect((await strike()).offCapMiddle).toBeLessThanOrEqual(1)
  await expect(label).toHaveCSS('text-decoration-line', 'none')

  // On, there is no line
  await toggle.click()
  await page.mouse.move(0, 0)
  await expect.poll(strike).toMatchObject({ covered: 0 })

  // Turning it off again draws the line from the left and turning it on draws it back, both unhurried enough to catch
  const session = await page.context().newCDPSession(page)
  await session.send('Animation.enable')
  await session.send('Animation.setPlaybackRate', { playbackRate: 0.05 })
  await toggle.click()
  await page.mouse.move(0, 0)
  const drawing = await strike()
  expect(drawing.covered).toBeGreaterThan(0)
  expect(drawing.covered).toBeLessThan(1)
  expect(drawing.left).toBe(0)
  await session.send('Animation.setPlaybackRate', { playbackRate: 1 })
  await expect.poll(strike).toMatchObject({ covered: 1 })
  await session.send('Animation.setPlaybackRate', { playbackRate: 0.05 })
  await toggle.click()
  await page.mouse.move(0, 0)
  const retracting = await strike()
  expect(retracting.covered).toBeGreaterThan(0)
  expect(retracting.covered).toBeLessThan(1)
  expect(retracting.left).toBe(0)
  await session.send('Animation.setPlaybackRate', { playbackRate: 1 })
  await expect.poll(strike).toMatchObject({ covered: 0 })
})

test('draws and removes the line at once when motion is reduced', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)
  await expect(toggle.locator('.app-hold-toggle-strike')).toHaveCSS('transition-duration', '0s')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(toggle.locator('.app-hold-toggle-strike')).toHaveCSS('transform', 'matrix(0, 0, 0, 1, 0, 0)')
})

test('keeps nothing from a press moved off the control before the hold is over', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)
  const box = await stableBox(toggle)

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect(toggle).toHaveAttribute('data-pressing', 'true')
  await page.mouse.move(box.x + box.width / 2, box.y - 60)
  // The press is dropped once the pointer leaves, so the hold that would have kept it can no longer finish
  await expect(toggle).toHaveAttribute('data-pressing', 'false')
  // Held past the time a hold takes, the dropped press still never finishes
  await expect(expect(toggle).toHaveAttribute('data-finished', 'true', { timeout: 1_500 })).rejects.toThrow()
  await page.mouse.up()

  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(toggle).toHaveAccessibleName(NAME)
  await page.reload()
  await expect(averageToggle(page)).toHaveAttribute('aria-pressed', 'false')
})

test('sinks only its inside when pressed, so a hold at its edge still keeps it', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)
  const box = await stableBox(toggle)
  const scaleOf = (selector: string) =>
    toggle.locator(selector).evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a)

  // The tint sits inside the word's box, so it sinks with the word
  const tintWidth = () => toggle.locator('.app-hold-toggle-clip').evaluate((element) => element.getBoundingClientRect().width)
  const restingTint = await tintWidth()
  expect(await scaleOf('.app-hold-toggle-label')).toBe(1)
  // Pressed 1px inside the top edge, where a button that shrank would slide out from under the pointer
  await page.mouse.move(box.x + box.width / 2, box.y + 1)
  await page.mouse.down()
  await expect.poll(async () => (await tintWidth()) / restingTint).toBeCloseTo(0.9, 2)
  expect(await scaleOf('.app-hold-toggle-label')).toBeCloseTo(0.9, 2)
  expect(await toggle.boundingBox()).toEqual(box)

  await expect(toggle).toHaveAccessibleName(KEPT_NAME, { timeout: 5_000 })
  await page.mouse.up()
  // Kept, the tint is wider for the dot, and the inside is back at full size
  await expect.poll(() => scaleOf('.app-hold-toggle-label')).toBe(1)
  expect(await tintWidth()).toBeGreaterThan(restingTint)
})

test('fades the fill back in when a press starts during the fade of the last hold', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)
  const fill = toggle.locator('.app-hold-toggle-fill')
  const opacityOf = () => fill.evaluate((element) => Number(getComputedStyle(element).opacity))
  // Waits for the card to settle first, since slowing everything would slow that too
  await stableBox(toggle)
  // Slows every transition tenfold, so the second press lands near the end of the fade however long the steps between take
  const session = await page.context().newCDPSession(page)
  await session.send('Animation.enable')
  await session.send('Animation.setPlaybackRate', { playbackRate: 0.1 })

  await longPress(page, toggle)
  await expect.poll(opacityOf, { timeout: 10_000 }).toBeLessThan(0.1)
  await page.mouse.down()
  await expect(toggle).toHaveAttribute('data-pressing', 'true')
  // The faded fill must not come back at full strength in one frame
  expect(await opacityOf()).toBeLessThan(0.5)
  await page.mouse.up()
})

test('keeps the average on by holding Enter, and a short Space press toggles it', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)

  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Space')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')

  await page.keyboard.down('Enter')
  await expect(toggle).toHaveAccessibleName(KEPT_NAME)
  await page.keyboard.up('Enter')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
})

test('holds the toggle off with its reason when there is no whole earlier period', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date: todayInTestTimezone() })
  await logInViaApi(page, user)
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)

  await expect(toggle).toHaveAttribute('aria-disabled', 'true')
  await expect(toggle).toHaveAccessibleDescription(NO_HISTORY)
  // A held off toggle is off, so the word is crossed out
  await expect(toggle.locator('.app-hold-toggle-strike')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  // The reason shows in the shared reason tooltip, so no native tooltip speaks beside it
  await expect(toggle).not.toHaveAttribute('title', /.+/)
  await toggle.click({ force: true })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText('No data for last month', { exact: true })).toBeVisible()

  // A long press on a held off toggle keeps nothing
  const box = await stableBox(toggle)

  // The reason hangs from the button, so a pointer low on it cannot pull the reason over the card title
  await page.mouse.move(0, 0)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 3)
  const reason = page.getByTestId('disabled-reason-tooltip')
  await expect(reason).toHaveText(NO_HISTORY)
  const reasonBox = await reason.boundingBox()
  const titleBox = await page.locator('.app-card').filter({ has: toggle }).locator('.app-label:not([data-title-measure])').boundingBox()
  if (!reasonBox || !titleBox) throw new Error('The reason or the title has no box to measure')
  const covers = reasonBox.x < titleBox.x + titleBox.width && reasonBox.x + reasonBox.width > titleBox.x
    && reasonBox.y < titleBox.y + titleBox.height && reasonBox.y + reasonBox.height > titleBox.y
  expect(covers).toBe(false)
  // Nor over the legend, whose "No data" wording says what the chart shows
  const legendBox = await page.getByText('No data for last month', { exact: true }).boundingBox()
  if (!legendBox) throw new Error('The legend has no box to measure')
  const coversLegend = reasonBox.x < legendBox.x + legendBox.width && reasonBox.x + reasonBox.width > legendBox.x
    && reasonBox.y < legendBox.y + legendBox.height && reasonBox.y + reasonBox.height > legendBox.y
  expect(coversLegend).toBe(false)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  // A press on a held off toggle never starts, so there is no pressing state to wait for over the length of a hold
  await expect(expect(toggle).toHaveAttribute('data-pressing', 'true', { timeout: 1_200 })).rejects.toThrow()
  await page.mouse.up()
  await expect(toggle).toHaveAccessibleName(NAME)
  // Enter on it does not run the action either
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(toggle).toHaveAccessibleName(NAME)
})

test('is held off on a range with no whole earlier period while another range has one', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)

  await expect(toggle).not.toHaveAttribute('aria-disabled', 'true')
  await page.getByRole('tab', { name: 'YTD' }).first().click()
  await expect(toggle).toHaveAttribute('aria-disabled', 'true')
  await expect(toggle).toHaveAccessibleDescription('Needs one whole year of history before this one.')
})

test('says what it is in the tooltip the card toggles use, with no separate hint button', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  await openPage(page, '/dashboard')

  const hint = (text: string) => page.getByTestId('control-hint-tooltip').filter({ hasText: text })
  await expect(averageToggle(page)).not.toHaveAttribute('title', /.+/)
  await averageToggle(page).hover()
  await expect(hint('Click to compare with your average month, and hold to use it as the default.')).toHaveCSS('opacity', '1')
  await expect(page.getByRole('button', { name: 'About the average' })).toHaveCount(0)
  await expect(page.getByText('Average', { exact: true })).toHaveCount(0)

  await longPress(page, averageToggle(page))
  await expect(hint('Click to compare with your average month, and hold to stop using it as the default.')).toHaveCSS('opacity', '1')
})

test('sits at the right end of the legend row, on its labels baseline and at the content edge, at every width', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)
  const card = page.locator('.app-card').filter({ has: toggle })
  // The legend row holds the two labels and the toggle's wrapper
  const legend = toggle.locator('xpath=../..')

  for (const kept of [false, true]) {
    if (kept) await longPress(page, toggle)
    for (const width of [1920, 1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await card.scrollIntoViewIfNeeded()
      await page.mouse.move(0, 0)
      const measure = async () => {
        const [legendBox, toggleBox, labelBox] = await Promise.all([legend.boundingBox(), toggle.boundingBox(), legend.locator('> div').first().boundingBox()])
        if (!legendBox || !toggleBox || !labelBox) throw new Error('The legend has no box to measure')
        // A line of text's baseline is the bottom of its content box less the font's descent, read from the glyphs
        // themselves rather than from how the layout placed them
        const glyphs = await legend.evaluate((legendEl) => {
          const context = document.createElement('canvas').getContext('2d')!
          const visibleText = (root: Element): Text => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              if ((node.textContent ?? '').trim()) return node as Text
            }
            throw new Error('No visible text to measure')
          }
          const read = (node: Text) => {
            const range = document.createRange()
            range.selectNodeContents(node)
            const style = getComputedStyle(node.parentElement!)
            context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
            const rect = range.getBoundingClientRect()
            return { baseline: rect.bottom - context.measureText('x').fontBoundingBoxDescent, right: rect.right }
          }
          const label = read(visibleText(legendEl.children[0]))
          const word = read(visibleText(legendEl.querySelector('.app-hold-toggle-label')!))
          return { baselineGap: Math.abs(word.baseline - label.baseline), wordRight: word.right }
        })
        return {
          baselineOk: glyphs.baselineGap <= 1,
          edgeOk: Math.abs(glyphs.wordRight - (legendBox.x + legendBox.width)) <= 1,
          // The button's room above and below sits in the legend's margins, so the row is no taller than its labels
          rowHeightOk: legendBox.height <= labelBox.height + 1,
        }
      }
      // Within a pixel, once the card has settled after the resize
      await expect.poll(measure, { message: `at ${width} wide, kept ${kept}` }).toEqual({ baselineOk: true, edgeOk: true, rowHeightOk: true })
    }
  }
})

test('keeps the amount row and the button where they are when the average turns on, and shortens the title to fit', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  await page.setViewportSize({ width: 1280, height: 900 })
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)
  const card = page.locator('.app-card').filter({ has: toggle })
  const amount = card.locator('p.font-financial')
  const title = card.locator('.app-label:not([data-title-measure])').first()
  await card.scrollIntoViewIfNeeded()
  const positions = async () => {
    const [toggleBox, amountBox] = await Promise.all([stableBox(toggle), amount.boundingBox()])
    return { toggleY: Math.round(toggleBox.y), amountY: Math.round(amountBox!.y) }
  }
  const before = await positions()

  await toggle.click()
  await page.mouse.move(0, 0)
  // The rolling text keeps a copy of each word for assistive technology beside the letters it rolls, so the title
  // is read by what it holds, not by its exact string
  await expect.poll(() => title.evaluate((element) => (element as HTMLElement).innerText)).toMatch(/avg\./)
  expect(await title.evaluate((element) => (element as HTMLElement).innerText)).not.toMatch(/average|last/)
  // The title's roll takes a moment, so what holds once it has stayed still is what a person is left with
  expect(await settledValue(positions)).toEqual(before)
})

test('tints a shape that hugs what shows with even room, wider on the left once the dot appears', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  await page.setViewportSize({ width: 1280, height: 900 })
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)
  await page.locator('.app-card').filter({ has: toggle }).scrollIntoViewIfNeeded()

  const rooms = async () => {
    await toggle.hover()
    return settledValue(() => toggle.evaluate((element) => {
      const tint = element.querySelector('.app-hold-toggle-clip')!.getBoundingClientRect()
      const word = element.querySelector('.app-hold-toggle-label')!.getBoundingClientRect()
      const dot = element.querySelector('.app-hold-toggle-dot')!.getBoundingClientRect()
      const kept = element.getAttribute('data-kept') === 'true'
      const left = kept ? Math.min(word.left, dot.left) : word.left
      const button = element.getBoundingClientRect()
      // The button itself fits what shows, so the hit area is the tint
      if (Math.abs(button.width - tint.width) > 1 || Math.abs(button.right - tint.right) > 1) return { left: 99, right: 99, top: 0, bottom: 0 }
      return {
        left: Math.round(left - tint.left),
        right: Math.round(tint.right - word.right),
        top: Math.round(word.top - tint.top),
        bottom: Math.round(tint.bottom - word.bottom),
      }
    }))
  }
  const even = (room: { left: number; right: number; top: number; bottom: number }) => {
    const values = Object.values(room)
    return Math.max(...values) - Math.min(...values) <= 1
  }

  expect(even(await rooms())).toBe(true)
  await toggle.click()
  expect(even(await rooms())).toBe(true)
  const wordBefore = await wordBox(toggle)
  await longPress(page, toggle)
  expect(even(await rooms())).toBe(true)
  // The word stays where it was while the tint widens for the dot
  const wordAfter = await wordBox(toggle)
  expect(Math.abs(wordAfter.x - wordBefore.x)).toBeLessThanOrEqual(0.5)
})

test('spells out average in the title where the header has room and shortens it only where it would not fit', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  await page.setViewportSize({ width: 1920, height: 900 })
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)
  const card = page.locator('.app-card').filter({ has: toggle })
  const title = card.locator('.app-label:not([data-title-measure])').first()
  const header = title.locator('xpath=..')
  await card.scrollIntoViewIfNeeded()
  const headerHeight = async () => Math.round((await header.boundingBox())!.height)
  const lastHeight = await headerHeight()
  await toggle.click()
  await page.mouse.move(0, 0)

  const word = async () => {
    // The roll keeps a copy of each word beside the letters it rolls, so the title is read by what it holds
    const text = await title.evaluate((element) => (element as HTMLElement).innerText)
    return /average/.test(text) ? 'average' : /avg\./.test(text) ? 'avg.' : 'other'
  }
  // The title never takes more lines than "last" does at the same width, and it is the full word at 1920 and the
  // short one at 1280, where the selector shares the row with the title to the pixel
  const seen: string[] = []
  for (const width of [1920, 1700, 1500, 1300, 1280, 1200, 1000, 768, 600, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const shown = await settledValue(async () => ({ word: await word(), height: await headerHeight() }))
    seen.push(shown.word)
    const withAverage = shown.height
    await toggle.click()
    await page.mouse.move(0, 0)
    const withLast = await settledValue(headerHeight)
    await toggle.click()
    await page.mouse.move(0, 0)
    await settledValue(async () => ({ word: await word(), height: await headerHeight() }))
    expect(withAverage, `header height at ${width}`).toBeLessThanOrEqual(withLast + 1)
  }
  expect(lastHeight).toBeGreaterThan(0)
  expect(seen[0]).toBe('average')
  expect(seen[4]).toBe('avg.')
  expect(seen).not.toContain('other')
})

test('keeps the range selector on the title row for every range, shortening average wherever the full word would move it', async ({ page, request }) => {
  // History reaches back over two whole years, with spending in earlier weeks, months, quarters and the year before
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 100_000, date: dayOfMonthFromNow(26, 1) })
  const today = new Date(`${todayInTestTimezone()}T00:00:00Z`)
  const daysBack = (days: number) => new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10)
  const dates = [daysBack(8), daysBack(15), daysBack(22), ...[1, 2, 3, 5, 8, 13, 14].map((months) => dayOfMonthFromNow(months, 2))]
  for (const date of dates) {
    await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -10_000, date })
  }
  await logInViaApi(page, user)
  await page.setViewportSize({ width: 1280, height: 900 })
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)
  const card = page.locator('.app-card').filter({ has: toggle })
  const title = card.locator('.app-label:not([data-title-measure])').first()
  const header = title.locator('xpath=..')
  await card.scrollIntoViewIfNeeded()
  await toggle.click()
  await page.mouse.move(0, 0)

  for (const range of ['WTD', 'MTD', 'QTD', 'YTD']) {
    await page.getByRole('tab', { name: range }).first().click()
    await page.mouse.move(0, 0)
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
    await page.mouse.move(0, 0)
    await expect(toggle, `average on for ${range}`).toHaveAttribute('aria-pressed', 'true')
    await expect(title, `title shows the average for ${range}`).toHaveText(/avg\.|average/)
    const shown = await settledValue(async () =>
      header.evaluate((element) => {
        const row = element as HTMLElement
        const titleBox = row.querySelector('.app-label:not([data-title-measure])')!.getBoundingClientRect()
        const selector = [...row.children].filter((child) => getComputedStyle(child).display !== 'none').at(-1)!.getBoundingClientRect()
        const text = (row.querySelector('.app-label:not([data-title-measure])') as HTMLElement).innerText
        return { word: /average/.test(text) ? 'average' : /avg\./.test(text) ? 'avg.' : 'other', selectorBelowTitle: selector.top >= titleBox.bottom - 1 }
      }),
    )
    // The selector stays on the title row for every range, and "quarter" is long enough that only the short word fits
    expect(shown.selectorBelowTitle, `selector on its own row at 1280 for ${range}`).toBe(false)
    expect(shown.word).not.toBe('other')
    if (range === 'QTD') expect(shown.word).toBe('avg.')
  }
})

// One test per size and theme keeps each inside the test time limit
const axisLabelCases = (['light', 'dark'] as const).flatMap((theme) =>
  ([[1280, 800], [768, 1024], [390, 844]] as const).map(([width, height]) => ({ theme, width, height })),
)

for (const { theme, width, height } of axisLabelCases) {
test(`leaves a gap between every two axis labels at every range with the average on and off, ${width} ${theme}`, async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 100_000, date: dayOfMonthFromNow(26, 1) })
  const today = new Date(`${todayInTestTimezone()}T00:00:00Z`)
  const daysBack = (days: number) => new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10)
  const dates = [daysBack(8), daysBack(15), daysBack(22), ...[1, 2, 3, 5, 8, 13, 14].map((months) => dayOfMonthFromNow(months, 2))]
  for (const date of dates) {
    await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -10_000, date })
  }
  await logInViaApi(page, user)
  const toggle = averageToggle(page)
  const card = page.locator('.app-card').filter({ has: toggle })
  const touching: string[] = []
  await page.emulateMedia({ colorScheme: theme })
  await page.setViewportSize({ width, height })
  await openPage(page, '/dashboard')
  await card.scrollIntoViewIfNeeded()
  const rangeNames = { WTD: 'Week to date', MTD: 'Month to date', QTD: 'Quarter to date', YTD: 'Year to date' } as const
  for (const range of ['WTD', 'MTD', 'QTD', 'YTD'] as const) {
    // The range is a segmented control on a wide screen and a dropdown on a phone, and either one names the range
    const tab = card.getByRole('tab', { name: range }).filter({ visible: true })
    if (await tab.count()) await tab.click()
    else {
      await card.getByRole('button', { name: /^Spending range:/ }).filter({ visible: true }).click()
      await card.getByRole('option', { name: rangeNames[range] }).click()
    }
    for (const averageOn of [false, true]) {
      if (((await toggle.getAttribute('aria-pressed')) === 'true') !== averageOn) await toggle.click()
      await page.mouse.move(0, 0)
      await expect(toggle).toHaveAttribute('aria-pressed', String(averageOn))
      const boxes = await settledValue(async () =>
        card.locator('.recharts-wrapper svg text').evaluateAll((nodes) =>
          nodes.map((node) => {
            const box = node.getBoundingClientRect()
            return { text: node.textContent, left: Math.round(box.left * 10) / 10, right: Math.round(box.right * 10) / 10 }
          }),
        ),
      )
      const ordered = boxes.sort((a, b) => a.left - b.left)
      expect(ordered.length, `${range} labels`).toBeGreaterThan(1)
      for (let index = 1; index < ordered.length; index++) {
        if (ordered[index].left - ordered[index - 1].right < 2) {
          touching.push(`${range} ${averageOn ? 'average' : 'last'}: ${ordered[index - 1].text} ${ordered[index].text}`)
        }
      }
    }
  }
  expect(touching).toEqual([])
})
}

test('fits beside the longest legend wording at a phone width, covering and cutting nothing', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date: todayInTestTimezone() })
  await logInViaApi(page, user)
  await page.setViewportSize({ width: 390, height: 844 })
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)
  const card = page.locator('.app-card').filter({ has: toggle })
  await card.scrollIntoViewIfNeeded()
  const noData = page.getByText('No data for last month', { exact: true })
  await expect(noData).toBeVisible()

  const measure = async () => {
    const [toggleBox, labelBox, bodyBox, thisMonthBox] = await Promise.all([
      stableBox(toggle),
      noData.boundingBox(),
      toggle.locator('xpath=ancestor::div[contains(@class, "overflow-hidden")][1]').boundingBox(),
      page.getByText('This month', { exact: true }).boundingBox(),
    ])
    const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
    return {
      insideBody: toggleBox.x >= bodyBox!.x && toggleBox.x + toggleBox.width <= bodyBox!.x + bodyBox!.width,
      // The button's side room is empty, so what it must clear is the wording, not its own box
      clearOfWording: !overlaps(await wordBox(toggle), labelBox!) && !overlaps(await wordBox(toggle), thisMonthBox!),
    }
  }
  await expect.poll(measure).toEqual({ insideBody: true, clearOfWording: true })
})

/** The box of the word inside a toggle, not of the button around it */
async function wordBox(toggle: Locator) {
  const box = await toggle.locator('.app-hold-toggle-label').boundingBox()
  if (!box) throw new Error('The toggle has no word to measure')
  return box
}

test('loads the earlier periods only while the average is on', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  const asked: string[] = []
  page.on('request', (message) => {
    if (message.url().includes('/dashboard/spending-comparison')) asked.push(new URL(message.url()).search)
  })
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText('Last month', { exact: true })).toBeVisible()
  expect(asked.length).toBeGreaterThan(0)
  expect(asked.filter((search) => search.includes('average=true'))).toEqual([])

  await toggle.click()
  await expect(page.getByText('Average month', { exact: true })).toBeVisible()
  expect(asked.filter((search) => search.includes('average=true'))).toHaveLength(1)

  // Back off, nothing more is asked of the history
  await toggle.click()
  await expect(page.getByText('Last month', { exact: true })).toBeVisible()
  expect(asked.filter((search) => search.includes('average=true'))).toHaveLength(1)
})

test('says what a click and a hold do for the range, over the window of each view', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 100_000, date: '2019-01-01' })
  await logInViaApi(page, user)
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)
  await page.locator('.app-card').filter({ has: toggle }).scrollIntoViewIfNeeded()

  const expected: Record<string, string> = {
    WTD: 'Click to compare with your average week, and hold to use it as the default. The average is calculated from the last 12 weeks, leaving out any without spending.',
    MTD: 'Click to compare with your average month, and hold to use it as the default. The average is calculated from the last 12 months, leaving out any without spending.',
    QTD: 'Click to compare with your average quarter, and hold to use it as the default. The average is calculated from the last 4 quarters, leaving out any without spending.',
    YTD: 'Click to compare with your average year, and hold to use it as the default. The average is calculated from the last 3 years, leaving out any without spending.',
  }
  for (const [range, text] of Object.entries(expected)) {
    await page.getByRole('tab', { name: range }).first().click()
    await expect(toggle).not.toHaveAttribute('aria-disabled', 'true')
    await toggle.hover()
    const hint = page.getByTestId('control-hint-tooltip').filter({ hasText: text })
    await expect(hint).toHaveCSS('opacity', '1')
    // With room above, the hint opens above the button
    const [hintBox, toggleBox] = await Promise.all([hint.locator('> div').boundingBox(), toggle.boundingBox()])
    expect(hintBox!.y + hintBox!.height).toBeLessThanOrEqual(toggleBox!.y + 1)
    await page.mouse.move(0, 0)
  }

  // With the button at the very top of the screen there is no room above, so the hint opens below it
  // A spacer after the page's content lets the button reach the top even though the page is short
  await toggle.evaluate((element) => {
    let scroller: HTMLElement = document.body
    for (let node = element.parentElement; node; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
        scroller = node
        break
      }
    }
    const spacer = document.createElement('div')
    spacer.style.height = '2000px'
    scroller.appendChild(spacer)
    element.scrollIntoView({ block: 'start' })
  })
  await toggle.hover()
  const below = page.getByTestId('control-hint-tooltip').filter({ hasText: expected.YTD })
  await expect(below).toHaveCSS('opacity', '1')
  const [belowBox, topBox] = await Promise.all([below.locator('> div').boundingBox(), toggle.boundingBox()])
  expect(belowBox!.y).toBeGreaterThanOrEqual(topBox!.y + topBox!.height - 1)
})

test('leaves a month without spending out of the average', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 100_000, date: dayOfMonthFromNow(3, 1) })
  // 300 three months back and 900 one month back, with nothing in the month between
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -30_000, date: dayOfMonthFromNow(3, 2) })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -90_000, date: dayOfMonthFromNow(1, 2) })
  await logInViaApi(page, user)
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)

  const averageResponse = page.waitForResponse((r) => r.url().includes('/dashboard/spending-comparison') && r.url().includes('average=true'))
  await toggle.click()
  await expect(page.getByText('Average month', { exact: true })).toBeVisible()
  // Day 2 averages 300 and 900 over two months, not over three with a zero
  const body = await (await averageResponse).json()
  expect(body.average_periods).toBe(3)
  expect(body.average_counts[1]).toBe(2)
  expect(body.average_sums[1]).toBe(120_000)
})

test('counts a month that spends only after the day reached this month, with nothing before it', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 100_000, date: dayOfMonthFromNow(2, 1) })
  // The last day of the month back is later than any day number this month has reached
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -60_000, date: dayOfMonthFromNow(1, 28) })
  await logInViaApi(page, user)
  await openPage(page, '/dashboard')

  const averageResponse = page.waitForResponse((r) => r.url().includes('/dashboard/spending-comparison') && r.url().includes('average=true'))
  await averageToggle(page).click()
  await expect(page.getByText('Average month', { exact: true })).toBeVisible()
  const body = await (await averageResponse).json()
  // The month two back holds no spending and is left out, so the one month back counts, still at nothing by day 2
  expect(body.average_periods).toBe(2)
  expect(body.average_counts[1]).toBe(1)
  expect(body.average_sums[1]).toBe(0)
})

test('shows the previous period with a reason when no earlier month held any spending', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 100_000, date: dayOfMonthFromNow(3, 1) })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date: todayInTestTimezone() })
  await logInViaApi(page, user)
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)
  await expect(toggle).not.toHaveAttribute('aria-disabled', 'true')

  await toggle.click()
  // The average has nothing to work out, so the card stays as it is without it, the way a range without history does
  await expect(toggle).toHaveAttribute('aria-disabled', 'true')
  await expect(toggle).toHaveAccessibleDescription('No spending in the whole months before this one to average.')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText('No data for last month', { exact: true })).toBeVisible()
  await expect(page.getByText('Average month', { exact: true })).toHaveCount(0)
})

test('flags only the average when a rate behind an old period is missing', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  // The history answers with a gap in an old rate, while the card's own spending converted fine
  await page.route('**/dashboard/spending-comparison?*average=true*', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    body.average_fx_status = { state: 'incomplete', missing_pairs: [{ base: 'USD', quote: 'CAD' }] }
    await route.fulfill({ response, json: body })
  })
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)
  await expect(page.getByText('Last month', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Average FX status' })).toHaveCount(0)

  await toggle.click()
  await expect(page.getByText('Average month', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Average FX status' })).toBeVisible()
  // The card's own badge still says its spending converted, since only the old period is missing a rate
  const cardBadge = page.getByRole('button', { name: 'Spending comparison FX status' })
  await cardBadge.hover()
  await expect(page.getByText('Spending in this comparison was already in your base currency')).toBeVisible()

  await toggle.click()
  await expect(page.getByRole('button', { name: 'Average FX status' })).toHaveCount(0)
})

test('waits for the average after a range change instead of showing the previous period first', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  await openPage(page, '/dashboard')
  const toggle = averageToggle(page)
  await toggle.click()
  await expect(page.getByText('Average month', { exact: true })).toBeVisible()

  // The history of the new range is slow, and the card holds its loading state through it
  await page.route('**/dashboard/spending-comparison?*range=WTD*average=true*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    await route.continue()
  })
  await page.getByRole('tab', { name: 'WTD' }).first().click()
  // While the history is on its way the card is behind its loading state, with neither line on show
  await expect(page.getByLabel('Loading spending comparison')).toBeVisible()
  await expect(page.getByText('Last week', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Average week', { exact: true })).toBeVisible()
  await expect(page.getByText('Last week', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Last month', { exact: true })).toHaveCount(0)
})

test('reads off and keeps the previous period when the average fails to load, and tries again on the next press', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  await page.route('**/dashboard/spending-comparison?*average=true*', (route) =>
    route.fulfill({ status: 500, json: { detail: 'The history could not be read' } }),
  )
  await openPage(page, '/dashboard')
  await expect(page.getByText('Last month', { exact: true })).toBeVisible()

  // The press cannot show the average, so the toggle does not claim it is on and the card is as it was
  const toggle = averageToggle(page)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText('Last month', { exact: true })).toBeVisible()
  await expect(page.getByText('Spending comparison could not load')).toHaveCount(0)
  // A toast says why the previous period is on show, for a touch screen and a screen reader, and the tooltip says it
  // again on hover
  await expect(page.getByRole('alert').filter({ hasText: "Your average couldn't load. Click AVG to try again." })).toBeVisible()
  await page.mouse.move(0, 0)
  await toggle.hover()
  await expect(
    page.getByTestId('control-hint-tooltip').filter({ hasText: "Your average couldn't load. Click to try again." }),
  ).toBeVisible()

  // Once the history can be read, one press asks for it again and shows the average
  await page.unroute('**/dashboard/spending-comparison?*average=true*')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Average month', { exact: true })).toBeVisible()
})

test('opens on the average with no sight of the previous period when it is kept on', async ({ page, request }) => {
  await seedThreeMonths(page, request)
  await openPage(page, '/dashboard')
  await longPress(page, averageToggle(page))
  await expect(page.getByText('Average month', { exact: true })).toBeVisible()

  // The history is slow, and the card holds its loading state through it
  await page.route('**/dashboard/spending-comparison?*average=true*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    await route.continue()
  })
  // A first visit in this browser has no saved answers to show in the meantime
  await page.addInitScript(() => window.localStorage.removeItem('lumina:query-cache'))
  await page.reload()
  await expect(page.getByLabel('Loading spending comparison')).toBeVisible()
  await expect(page.getByText('Last month', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Average month', { exact: true })).toBeVisible()
})
