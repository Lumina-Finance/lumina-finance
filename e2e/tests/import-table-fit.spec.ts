import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { measureFit, measureOwnScroll } from '../support/layout'

// Runs on desktop only: it sets the window sizes it checks itself

/**
 * Guards the CSV import's Column Mapping, Category Matching and Merchant Matching tables, which share
 * their layout with the Firefly III and Actual Budget importers. Each held a fixed minimum width, so on
 * a 1280px window the matching tables scrolled sideways inside a clipping box, and the column mapping
 * table pushed the whole pane sideways. The same clipping box cut off a row's help where it reached past
 * the table. Below the desktop layout the tables still scroll sideways, but only inside their own box
 */

// From the desktop layout's first width, so a switch that drifts wider fails here
const DESKTOP_WIDTHS = [1920, 1280, 1050]

const NARROW_WIDTHS = [1024, 768, 390]

// Reports every width and step that fails, rather than stopping at the first
const soft = expect.configure({ soft: true })

// Two categories with names, one of which the user already holds as income while its amount reads as an
// expense, so creating it as a new category proposes a new name with a note on why
const CSV = [
  'Date,Amount,Category,Merchant',
  '2024-03-15,-42.50,Groceries,Corner Market',
  '2024-03-17,-30.00,Salary,Studio',
].join('\n')

const STEPS = ['Column Mapping', 'Category Matching', 'Merchant Matching']

async function openMatchingSteps(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'categories.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })
  await expect(page.getByRole('combobox', { name: 'Existing Category Salary', exact: true })).toBeVisible()
}

/** Each step's table */
function tableOf(page: Page, step: string) {
  return page.locator('section').filter({ has: page.getByText(step, { exact: true }) }).getByRole('table')
}

/** The boxes from the table up to the page that scroll up and down */
function scrollingAround(table: Locator) {
  return table.evaluate((node) => {
    const scrolling: string[] = []
    for (let box: Element | null = node; box; box = box.parentElement) {
      if (box.scrollHeight > box.clientHeight + 1 && getComputedStyle(box).overflowY !== 'visible') {
        scrolling.push(`${box.tagName.toLowerCase()}.${box.className}`)
      }
    }
    return scrolling
  })
}

test('fits each import table to a desktop window, with every row\'s controls on screen', async ({ page, request }) => {
  await openMatchingSteps(page, request)

  for (const width of DESKTOP_WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    for (const step of STEPS) {
      const table = tableOf(page, step)
      await expect(table).toBeVisible()
      await soft.poll(() => measureFit(table), { message: `${step} at ${width}px` }).toEqual({ scrolling: [], clipped: [] })
    }

    // A row's dropdown opens against where its field sat, without scrolling anything sideways first. The
    // field moves with the open list, so its place is read before it opens
    const field = page.getByRole('combobox', { name: 'Existing Category Groceries', exact: true })
    await field.scrollIntoViewIfNeeded()
    const fieldBox = await field.boundingBox()
    await field.click()
    const list = page.getByRole('listbox')
    await expect(list).toBeInViewport({ ratio: 1 })
    const listBox = await list.boundingBox()
    const gap = Math.min(Math.abs(listBox!.y - (fieldBox!.y + fieldBox!.height)), Math.abs(fieldBox!.y - (listBox!.y + listBox!.height)))
    // The open box grows away from whichever side it is pinned by, so one of its edges stays with the field
    const pinned = Math.abs(listBox!.x - fieldBox!.x) <= 16
      || Math.abs(listBox!.x + listBox!.width - (fieldBox!.x + fieldBox!.width)) <= 16
    expect({ gap: gap <= 16, pinned }, `dropdown at ${width}px`).toEqual({ gap: true, pinned: true })
    await page.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
  }
})

test('keeps a narrow window\'s sideways scroll inside each import table\'s own box', async ({ page, request }) => {
  await openMatchingSteps(page, request)

  for (const width of NARROW_WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    for (const step of STEPS) {
      const table = tableOf(page, step)
      await expect(table).toBeVisible()
      // The table keeps its columns' width, so a phone or tablet scrolls the box right around it, and
      // nothing past that box, up to the page
      await soft.poll(() => measureOwnScroll(table), { message: `${step} at ${width}px` })
        .toEqual({ scrolls: width <= 768 ? true : expect.any(Boolean), outside: [] })
    }
  }
})

test('opens the note on a renamed category in full in a short table', async ({ page, request }) => {
  await openMatchingSteps(page, request)
  await page.getByRole('combobox', { name: 'Existing Category Salary', exact: true }).click()
  await page.getByRole('option', { name: 'Create new category' }).click()
  const trigger = page.getByRole('button', { name: 'Why Salary has a new name', exact: true })
  const table = tableOf(page, 'Category Matching')

  for (const width of DESKTOP_WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await trigger.scrollIntoViewIfNeeded()
    const scrollingBefore = await scrollingAround(table)
    await trigger.press('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const note = page.getByText('"Salary" is already an income category')
    await expect(note).toBeInViewport({ ratio: 1 })

    // Nothing covers or cuts off any corner of the note, and opening it doesn't make a box scroll that
    // didn't before
    const hiddenCorners = await note.evaluate((panel) => {
      const rect = panel.getBoundingClientRect()
      return [[rect.left + 2, rect.top + 2], [rect.right - 2, rect.top + 2], [rect.left + 2, rect.bottom - 2], [rect.right - 2, rect.bottom - 2]]
        .filter(([x, y]) => !panel.contains(document.elementFromPoint(x, y))).length
    })
    expect({ hiddenCorners, scrolling: await scrollingAround(table) }, `at ${width}px`)
      .toEqual({ hiddenCorners: 0, scrolling: scrollingBefore })

    await trigger.press('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  }
})
