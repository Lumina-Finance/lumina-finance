import { expect, test, type ElementHandle, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only: each test sets the one size it needs itself with setViewportSize, so the tablet and
// phone projects would only repeat it

/**
 * Guards the reason a greyed-out button gives when the surface holding the button scrolls. The reason was
 * placed once, when it opened, and a scroll left it behind, covering the button or floating over unrelated
 * content. It now follows the control while the control is in view and closes once the control scrolls out
 * of view. The control here is "Archive instead" in the Edit account dialogue's delete step, which is held
 * off while the account has future dated transactions and sits at the foot of the dialogue's scrolling body
 */

const REASON = /future dated transactions/
const TOOLTIP = 'disabled-reason-tooltip'

// How far a following reason may sit from its control's edge. The shared placement leaves a small gap
const FOLLOW_DISTANCE_PX = 40

const PHONE = { width: 390, height: 667 }
// Short enough that the dialogue's body scrolls at this width
const DESKTOP = { width: 1280, height: 560 }

type Box = { left: number; top: number; right: number; bottom: number }
type Shown = Box & { opacity: number }
type Body = ElementHandle<HTMLElement>

/** Opens the delete step of the Edit account dialogue for an account whose archive is held off */
async function openHeldOffArchive(
  page: Page,
  request: Parameters<typeof signUpUser>[0],
  { colorScheme, size }: { colorScheme: 'light' | 'dark'; size: { width: number; height: number } },
) {
  await page.emulateMedia({ colorScheme })
  await page.setViewportSize(size)
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -5000,
    date: daysFromTodayInTestTimezone(3),
  })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click()

  const archive = dialog.getByRole('button', { name: 'Archive instead', exact: true })
  await expect(archive).toHaveAttribute('aria-disabled', 'true')

  // The body that scrolls is the nearest scrolling ancestor of the button
  const body = (await archive.evaluateHandle((button): HTMLElement => {
    for (let node = button.parentElement; node; node = node.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node
    }
    throw new Error('the button has no scrolling ancestor')
  })).asElement() as Body
  await waitUntilStill(archive, body)
  return { archive, body }
}

/** Waits until the button is whole in the body and has stopped moving, since the delete step grows in and then scrolls itself into view */
async function waitUntilStill(control: Locator, body: Body) {
  let last = ''
  let stillPolls = 0
  await expect.poll(async () => {
    const button = await readBox(control)
    const view = await readBox(body)
    const now = JSON.stringify(button)
    stillPolls = now === last ? stillPolls + 1 : 0
    last = now
    return stillPolls >= 2 && button.top >= view.top && button.bottom <= view.bottom
  }, { intervals: [250] }).toBe(true)
}

/** Scrolls the body back from its end, where the opened step leaves it, to leave that much room to scroll down */
async function leaveRoomBelow(body: Body, fromEnd: number) {
  await body.evaluate((element, distance) => element.scrollTo(0, element.scrollHeight - element.clientHeight - distance), fromEnd)
}

/** The distance the body can still scroll up and down */
async function readRoom(body: Body) {
  return body.evaluate((element) => ({ above: element.scrollTop, below: element.scrollHeight - element.clientHeight - element.scrollTop }))
}

/** Focuses the button by keyboard, which shows its reason beside it, without scrolling the body */
async function showReasonByKeyboard(page: Page, archive: Locator, body: Body) {
  const view = await readBox(body)
  const button = await readBox(archive)
  expect(button.top >= view.top && button.bottom <= view.bottom, 'the button is whole in the body before its reason opens').toBe(true)
  // The opened step puts focus on this button already, by script. Leaving it and coming back by key is the keyboard's turn
  await archive.evaluate((element) => element.blur())
  await page.keyboard.press('Shift')
  await archive.focus()
  await expect(archive).toBeFocused()
  await expect.poll(async () => (await readReason(page))?.opacity ?? 0).toBe(1)
}

/** The reason's card as it is on screen, or null while the page has none */
async function readReason(page: Page): Promise<Shown | null> {
  return page.evaluate(({ testId, source }) => {
    const matches = new RegExp(source)
    const wrapper = [...document.querySelectorAll(`[data-testid="${testId}"]`)].find((node) => matches.test(node.textContent ?? ''))
    const card = wrapper?.firstElementChild
    if (!wrapper || !card) return null
    const box = card.getBoundingClientRect()
    return { opacity: Number(getComputedStyle(wrapper).opacity), left: box.left, top: box.top, right: box.right, bottom: box.bottom }
  }, { testId: TOOLTIP, source: REASON.source })
}

async function readBox(target: Locator | ElementHandle): Promise<Box> {
  const box = (await target.boundingBox())!
  return { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height }
}

function overlaps(a: Box, b: Box) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/** Names what is wrong with the reason now, or 'ok' when it follows its button in view or is gone */
async function judgeReason(page: Page, archive: Locator, body: Body) {
  const reason = await readReason(page)
  if (!reason || reason.opacity === 0) return 'ok'
  const button = await readBox(archive)
  if (!overlaps(button, await readBox(body))) return 'the reason floats on after its button left the body'
  if (overlaps(reason, button)) return 'the reason covers its button'
  const gap = Math.max(button.top - reason.bottom, reason.top - button.bottom)
  if (gap > FOLLOW_DISTANCE_PX) return `the reason sits ${Math.round(gap)}px from its button`
  return 'ok'
}

/** Expects the reason to follow the button or be gone, and to stay so a couple of frames later */
async function expectReasonFollowsOrCloses(page: Page, archive: Locator, body: Body) {
  await expect.poll(() => judgeReason(page, archive, body)).toBe('ok')
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(await judgeReason(page, archive, body)).toBe('ok')
}

/** Expects the reason to be shown, within the follow distance of its button and clear of it, and to stay so a couple of frames later */
async function expectReasonKeepsFollowing(page: Page, archive: Locator, body: Body) {
  const judge = async () => ((await readReason(page))?.opacity === 1 ? judgeReason(page, archive, body) : 'the reason is not shown')
  await expect.poll(judge).toBe('ok')
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(await judge()).toBe('ok')
}

/** Scrolls the body by a distance and returns how far the button moved down the screen */
async function scrollBodyBy(archive: Locator, body: Body, distance: number) {
  const before = await readBox(archive)
  await body.evaluate((element, by) => element.scrollBy(0, by), distance)
  const after = await readBox(archive)
  return Math.round(after.top - before.top)
}

for (const colorScheme of ['dark', 'light'] as const) {
  test.describe(`in the ${colorScheme} theme`, () => {
    test('moves the reason with its button when the body scrolls 45px on a phone', async ({ page, request }) => {
      const { archive, body } = await openHeldOffArchive(page, request, { colorScheme, size: PHONE })
      await leaveRoomBelow(body, 45)
      await showReasonByKeyboard(page, archive, body)
      expect(await judgeReason(page, archive, body)).toBe('ok')

      expect(await scrollBodyBy(archive, body, 45)).toBe(-45)
      // The button is still whole in the body, so its reason stays
      const view = await readBox(body)
      const button = await readBox(archive)
      expect(button.top >= view.top && button.bottom <= view.bottom, 'the button is still whole in the body').toBe(true)
      await expectReasonKeepsFollowing(page, archive, body)
    })

    test('keeps the reason while its button is only partly in view', async ({ page, request }) => {
      const { archive, body } = await openHeldOffArchive(page, request, { colorScheme, size: DESKTOP })
      await showReasonByKeyboard(page, archive, body)
      expect((await readRoom(body)).above).toBeGreaterThanOrEqual(100)

      // Scroll back until half of the button is past the foot of the body
      const view = await readBox(body)
      const button = await readBox(archive)
      const distance = Math.ceil(view.bottom - button.bottom + (button.bottom - button.top) / 2)
      expect(await scrollBodyBy(archive, body, -distance)).toBe(distance)
      const partly = await readBox(archive)
      expect(partly.top < view.bottom && partly.bottom > view.bottom, 'the button is cut by the foot of the body').toBe(true)
      await expectReasonKeepsFollowing(page, archive, body)
    })

    // The button has 33px below it in this dialogue, so scrolling back 100px moves it past the foot of the body
    test('closes the reason when the body scrolls back 100px on a desktop', async ({ page, request }) => {
      const { archive, body } = await openHeldOffArchive(page, request, { colorScheme, size: DESKTOP })
      await showReasonByKeyboard(page, archive, body)
      expect(await judgeReason(page, archive, body)).toBe('ok')
      expect((await readRoom(body)).above).toBeGreaterThanOrEqual(100)

      expect(await scrollBodyBy(archive, body, -100)).toBe(100)
      await expectReasonFollowsOrCloses(page, archive, body)
    })

    test('does not leave the reason at its old place when Page Down scrolls the body', async ({ page, request }) => {
      const { archive, body } = await openHeldOffArchive(page, request, { colorScheme, size: PHONE })
      await leaveRoomBelow(body, 60)
      await showReasonByKeyboard(page, archive, body)
      const before = (await readReason(page))!
      const scrolledBefore = (await readRoom(body)).above

      await page.keyboard.press('PageDown')
      await expect.poll(async () => (await readRoom(body)).above).toBeGreaterThan(scrolledBefore)
      // The button is still in view after the key, so its reason stays and moves with it
      expect(overlaps(await readBox(archive), await readBox(body))).toBe(true)
      await expectReasonKeepsFollowing(page, archive, body)
      const after = await readReason(page)
      const isAtOldPlace = !!after && after.opacity > 0 && after.top === before.top && after.left === before.left
      expect(isAtOldPlace).toBe(false)
    })

    test('closes the reason when the body scrolls its button out of view', async ({ page, request }) => {
      const { archive, body } = await openHeldOffArchive(page, request, { colorScheme, size: PHONE })
      await showReasonByKeyboard(page, archive, body)
      expect(await judgeReason(page, archive, body)).toBe('ok')

      await body.evaluate((element) => element.scrollTo(0, 0))
      expect(overlaps(await readBox(archive), await readBox(body))).toBe(false)
      await expectReasonFollowsOrCloses(page, archive, body)
    })
  })
}
