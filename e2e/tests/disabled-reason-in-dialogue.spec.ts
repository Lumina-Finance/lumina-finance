import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only: each test sets the sizes it checks itself. A disabled button's reason, shown by
// keyboard focus or by the pointer, stays inside its dialogue, however near the dialogue's bottom the button is

const TOOLTIP = 'disabled-reason-tooltip'
const SAVE_REASON = 'Finish or cancel deleting the account first'
const ARCHIVE_REASON = "This account can't be archived because it has future dated transactions."
const SIZES = [
  { width: 1280, height: 800 },
  { width: 390, height: 667 },
]

/** Opens the account's edit dialogue at its delete step, once the step has stopped moving */
async function openDeleteStep(page: Page, accountId: string) {
  await openPage(page, `/accounts/${accountId}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const dialogue = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await expect(dialogue).toBeVisible()
  const trash = dialogue.getByRole('button', { name: 'Delete account', exact: true })
  await trash.focus()
  await trash.press('Enter')
  const continueButton = dialogue.getByRole('button', { name: 'Continue', exact: true })
  await expect(continueButton).toBeVisible()
  let previous = ''
  await expect.poll(async () => {
    const now = JSON.stringify([await dialogue.boundingBox(), await continueButton.boundingBox()])
    const still = now === previous
    previous = now
    return still
  }).toBe(true)
  return dialogue
}

/** Presses Tab from nothing focused, the pointer parked away, until the control has focus */
async function tabTo(page: Page, control: Locator) {
  await page.mouse.move(1, 1)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  for (let presses = 0; presses < 25 && !(await control.evaluate((element) => element === document.activeElement)); presses += 1) {
    await page.keyboard.press('Tab')
  }
  await expect(control).toBeFocused()
}

/** Moves the pointer over the middle of the control from outside the window */
async function hoverMiddleOf(page: Page, control: Locator) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.mouse.move(1, 1)
  const box = (await control.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 })
  return box
}

/**
 * The drawn box of the reason with this text that is shown, once it has faded in and settled. The dialogue's
 * trash and Save changes buttons give the same reason, so the one shown is the one with full opacity
 */
async function readReason(page: Page, text: string) {
  const tooltips = page.getByTestId(TOOLTIP).filter({ hasText: text })
  const readShown = () => tooltips.evaluateAll((nodes) => {
    const shown = nodes.filter((node) => getComputedStyle(node).opacity === '1')
    const card = shown.length === 1 ? shown[0].querySelector('.app-cursor-tooltip-flip') : null
    if (!card) return null
    const { x, y, width, height } = card.getBoundingClientRect()
    return { x, y, width, height }
  })
  let previous = await readShown()
  await expect.poll(async () => {
    const now = await readShown()
    const still = now !== null && now.height > 0 && now.x === previous?.x && now.y === previous?.y
    previous = now
    return still
  }).toBe(true)
  return { box: (await readShown())! }
}

/** Expects the reason's box to lie wholly inside the dialogue's */
async function expectInside(page: Page, dialogue: Locator, text: string, at: string) {
  const { box } = await readReason(page, text)
  const frame = (await dialogue.boundingBox())!
  expect.soft(box.x, `left edge at ${at}`).toBeGreaterThanOrEqual(frame.x)
  expect.soft(box.y, `top edge at ${at}`).toBeGreaterThanOrEqual(frame.y)
  expect.soft(box.x + box.width, `right edge at ${at}`).toBeLessThanOrEqual(frame.x + frame.width)
  expect.soft(box.y + box.height, `bottom edge at ${at}`).toBeLessThanOrEqual(frame.y + frame.height)
  return box
}

test('keeps a footer button\'s reason inside the dialogue and above the button, by keyboard and by pointer', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -5000 })
  await logInViaApi(page, user)

  for (const size of SIZES) {
    const at = `${size.width}×${size.height}`
    await page.setViewportSize(size)
    // Opening the delete step holds Save changes off until it is finished or cancelled
    const dialogue = await openDeleteStep(page, account.id)
    const save = dialogue.getByRole('button', { name: 'Save changes', exact: true })
    await expect(save).toHaveAttribute('aria-disabled', 'true')

    // By keyboard, the reason hangs from the button and stays within the dialogue
    await tabTo(page, save)
    const byKeyboard = await expectInside(page, dialogue, SAVE_REASON, `${at} by keyboard`)
    const button = (await save.boundingBox())!
    expect.soft(byKeyboard.y + byKeyboard.height, `above the button at ${at} by keyboard`).toBeLessThanOrEqual(button.y)

    // By pointer, the reason follows the pointer and stays within the dialogue too
    await hoverMiddleOf(page, save)
    const byPointer = await expectInside(page, dialogue, SAVE_REASON, `${at} by pointer`)
    expect.soft(byPointer.y + byPointer.height, `above the button at ${at} by pointer`).toBeLessThanOrEqual(button.y + button.height / 2)
  }
})

test('keeps the held-off Archive instead reason inside the dialogue, by keyboard and by pointer', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -5000,
    date: daysFromTodayInTestTimezone(30),
  })
  await logInViaApi(page, user)

  for (const size of SIZES) {
    const at = `${size.width}×${size.height}`
    await page.setViewportSize(size)
    const dialogue = await openDeleteStep(page, account.id)
    const archiveInstead = dialogue.getByRole('button', { name: 'Archive instead', exact: true })
    await expect(archiveInstead).toHaveAttribute('aria-disabled', 'true')

    await tabTo(page, archiveInstead)
    const byKeyboard = await expectInside(page, dialogue, ARCHIVE_REASON, `${at} by keyboard`)
    // Near the bottom of the body the reason rises above the button, clear of the footer under it
    const archiveBox = (await archiveInstead.boundingBox())!
    expect.soft(byKeyboard.y + byKeyboard.height, `above the button at ${at} by keyboard`).toBeLessThanOrEqual(archiveBox.y)

    await hoverMiddleOf(page, archiveInstead)
    await expectInside(page, dialogue, ARCHIVE_REASON, `${at} by pointer`)
  }
})
