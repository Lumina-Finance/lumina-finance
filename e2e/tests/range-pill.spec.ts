import { expect, test, type Page } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only: it sets the widths it checks itself, opening each page wide and then narrowing it

/**
 * Guards the range pill that the dashboard widgets and the account cards show on a narrow page. Its
 * glass floats over the page so its list can open across the content below, and the slot holding its
 * place used to be measured once, while a page opened wider was hiding the pill. Narrowing the window
 * then left the slot at almost no height, and the pill covered the figure below it
 */

const PAGES = [
  // Opened wider than every card's breakpoint: the balance card's 750px and the spending cards' 1200px
  { name: 'an account page', wide: 1280, pills: ['Balance range', 'Spending range', 'Merchant range'] },
  { name: 'the dashboard', wide: 1024, pills: ['Breakdown range', 'Spending range'] },
] as const

/**
 * How far the space each pill holds in the layout reaches below the bottom of its glass. Below zero, the
 * pill covers what follows it by that much
 */
async function measureClearances(page: Page, pills: readonly string[]): Promise<number[]> {
  return Promise.all(pills.map(async (name) => {
    const head = page.getByRole('button', { name: new RegExp(`^${name}: `) }).filter({ visible: true })
    await expect(head).toHaveCount(1)
    return head.evaluate((node) => {
      const glass = node.parentElement!.getBoundingClientRect()
      const slot = node.parentElement!.parentElement!.getBoundingClientRect()
      return Math.round(slot.bottom - glass.bottom)
    })
  }))
}

for (const { name, wide, pills } of PAGES) {
  test(`keeps each range pill clear of what follows it on ${name} narrowed after a wide load`, async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 1000 })
    await createTransaction(request, user, {
      accountId: account.id,
      categoryName: 'Groceries',
      amount: -1000,
      date: daysFromTodayInTestTimezone(-1),
    })
    await logInViaApi(page, user)
    const path = name === 'the dashboard' ? '/dashboard' : `/accounts/${account.id}`

    // The page opened at the narrow width is the reference: there each pill was showing when measured
    await page.setViewportSize({ width: 390, height: 844 })
    await openPage(page, path)
    const narrow = await measureClearances(page, pills)
    for (const clearance of narrow) expect(clearance).toBeGreaterThanOrEqual(0)

    await page.setViewportSize({ width: wide, height: 900 })
    await openPage(page, path)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => measureClearances(page, pills)).toEqual(narrow)
  })
}
