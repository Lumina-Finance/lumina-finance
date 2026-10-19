import { expect, test, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: it sets every width it checks itself with `page.setViewportSize`

const PHONE = { width: 390, height: 844 }
const JUST_BELOW_SWITCH = { width: 749, height: 844 }
const DESKTOP = { width: 1280, height: 800 }

// The card's own `min-[750px]:min-h-[440px]`, which is the height the loaded card holds at desktop
const DESKTOP_CARD_HEIGHT = 440

/** Holds the account request so the loading placeholder stays on screen while the layout is read */
async function openLoadingAccount(page: Page, accountId: string): Promise<void> {
  await page.route(`${API_BASE_URL}/accounts/${accountId}`, () => new Promise(() => {}))
  await page.goto(`/accounts/${accountId}`)
  await expect(page.getByRole('status').filter({ hasText: 'Loading account' })).toBeAttached()
}

/** Reads the first placeholder card: its height, the spacing it puts above its fact list, and the gap above its last block */
function measureFirstCard(page: Page) {
  return page.locator('[aria-hidden="true"] section.app-card').first().evaluate((card) => {
    const children = [...card.children] as HTMLElement[]
    const factList = children.find((child) => child.classList.contains('flex-col') && child.classList.contains('gap-3'))!
    const rows = [...factList.children] as HTMLElement[]
    const block = children[children.length - 1]
    const aboveFacts = children[children.indexOf(factList) - 1]
    return {
      height: card.getBoundingClientRect().height,
      rhythm: factList.getBoundingClientRect().top - aboveFacts.getBoundingClientRect().bottom,
      gap: block.getBoundingClientRect().top - rows[rows.length - 1].getBoundingClientRect().bottom,
    }
  })
}

// Below 750px the card has no minimum height, so nothing pushes the last block away from the last pair of
// bars. It keeps the spacing the card puts above its fact list at every width, and the card holds the
// height the loaded one has at desktop, so nothing moves when loading ends
test('keeps the account loading placeholder block clear of the bars above it at every width', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Loading spacing' })
  await logInViaApi(page, user)

  await page.setViewportSize(PHONE)
  await openLoadingAccount(page, account.id)
  const phone = await measureFirstCard(page)
  expect(phone.rhythm, 'spacing above the fact list').toBeGreaterThan(0)
  expect(phone.gap, 'gap above the last block at 390px').toBeGreaterThanOrEqual(phone.rhythm)

  await page.setViewportSize(JUST_BELOW_SWITCH)
  const narrow = await measureFirstCard(page)
  expect(narrow.gap, 'gap above the last block at 749px, as on a phone').toBe(phone.gap)

  await page.setViewportSize(DESKTOP)
  const desktop = await measureFirstCard(page)
  expect(desktop.height, 'card height at 1280px').toBe(DESKTOP_CARD_HEIGHT)
  expect(desktop.gap, 'gap above the last block at 1280px').toBeGreaterThanOrEqual(desktop.rhythm)
})
