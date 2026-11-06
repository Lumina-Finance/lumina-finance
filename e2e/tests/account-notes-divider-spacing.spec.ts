import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import {
  asUser,
  createAccount,
  createTaxAdvantagedCategory,
  signUpUser,
  type SeededAccount,
  type TestUser,
} from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: it sets every width it checks itself with `page.setViewportSize`

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }

// Enough lines to fill the notes box until it scrolls, so the card's content reaches its minimum height
const LONG_NOTES = Array.from({ length: 12 }, (_, index) => `Line ${index + 1} of a long note`).join('\n')

async function addNotes(request: APIRequestContext, user: TestUser, accountId: string, notes: string) {
  const response = await request.patch(`${API_BASE_URL}/accounts/${accountId}`, { headers: asUser(user), data: { notes } })
  expect(response.status()).toBe(200)
}

/**
 * Reads the room above and below the divider over the account's status, and how far the status band sits
 * from the bottom of the card's content
 */
function measureDivider(page: Page, statusTitle: string) {
  return page.locator('section.app-card').filter({ has: page.locator('h1') }).evaluate((card, title) => {
    const status = [...card.querySelectorAll('p')].find((paragraph) => paragraph.textContent === title)!
    let divider = status.parentElement!
    while (getComputedStyle(divider).borderTopWidth !== '1px') divider = divider.parentElement!
    const above = card.querySelector('[role="region"]') ?? card.querySelector('dl')!
    const dividerTop = divider.getBoundingClientRect().top
    const cardStyle = getComputedStyle(card)
    const cardContentBottom =
      card.getBoundingClientRect().bottom - parseFloat(cardStyle.paddingBottom) - parseFloat(cardStyle.borderBottomWidth)
    return {
      above: Math.round(dividerTop - above.getBoundingClientRect().bottom),
      below: Math.round(status.getBoundingClientRect().top - dividerTop - 1),
      fromCardBottom: Math.round(cardContentBottom - divider.getBoundingClientRect().bottom),
    }
  }, statusTitle)
}

/** Signs up a user with long, short and no notes, and a linked plan with long notes, then signs the page in */
async function seedAccounts(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request)
  const longNotes = await createAccount(request, user, { name: 'Long notes' })
  await addNotes(request, user, longNotes.id, LONG_NOTES)
  const shortNote = await createAccount(request, user, { name: 'Short note' })
  await addNotes(request, user, shortNote.id, 'A bunch of text to explain what this account is for')
  const planId = await createTaxAdvantagedCategory(request, user, 'Retirement plan')
  const planWithNotes = await createAccount(request, user, { name: 'Plan with notes', taxAdvantagedCategoryId: planId })
  await addNotes(request, user, planWithNotes.id, LONG_NOTES)
  const noNotes = await createAccount(request, user, { name: 'No notes' })
  await logInViaApi(page, user)
  return { longNotes, shortNote, planWithNotes, noNotes }
}

async function expectEvenDivider(page: Page, account: SeededAccount, statusTitle: string, width: number) {
  await openPage(page, `/accounts/${account.id}`)
  const spacing = await measureDivider(page, statusTitle)
  expect(spacing.below, `room below the divider for ${account.name} at ${width}px`).toBeGreaterThan(0)
  expect(spacing.above, `room above the divider for ${account.name} at ${width}px`).toBe(spacing.below)
}

// Long notes fill the card's minimum height, so nothing but the band's own spacing keeps them off the divider
test('keeps long notes as far from the divider as the status below it on a desktop', async ({ page, request }) => {
  const { longNotes, planWithNotes } = await seedAccounts(page, request)
  await page.setViewportSize(DESKTOP)
  await expectEvenDivider(page, longNotes, 'Standard account', DESKTOP.width)
  await expectEvenDivider(page, planWithNotes, 'Retirement plan', DESKTOP.width)
})

// A phone's card has no minimum height, so the divider always follows the notes, 20px below them
test('keeps notes 20px from the divider with the status below it on a phone', async ({ page, request }) => {
  const { longNotes, shortNote, planWithNotes } = await seedAccounts(page, request)
  await page.setViewportSize(PHONE)
  for (const [account, statusTitle] of [
    [shortNote, 'Standard account'],
    [longNotes, 'Standard account'],
    [planWithNotes, 'Retirement plan'],
  ] as const) {
    await openPage(page, `/accounts/${account.id}`)
    const spacing = await measureDivider(page, statusTitle)
    expect(spacing.above, `room above the divider for ${account.name} on a phone`).toBe(20)
    expect(spacing.below, `room below the divider for ${account.name} on a phone`).toBeGreaterThan(0)
  }
})

// A short note or none leaves the card room to spare, and the status stays at the bottom of the card
test('keeps the account status at the bottom of the card when the notes are short or missing', async ({ page, request }) => {
  const { shortNote, noNotes } = await seedAccounts(page, request)
  await page.setViewportSize(DESKTOP)
  for (const account of [shortNote, noNotes]) {
    await openPage(page, `/accounts/${account.id}`)
    const spacing = await measureDivider(page, 'Standard account')
    expect(spacing.above, `room above the divider for ${account.name}`).toBeGreaterThanOrEqual(spacing.below)
    expect(spacing.fromCardBottom, `status band at the bottom of the card for ${account.name}`).toBe(0)
  }
})
