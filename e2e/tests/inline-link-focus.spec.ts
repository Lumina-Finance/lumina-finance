import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'
import { API_BASE_URL } from '../support/target'

// Runs at every size: a link in a sentence can wrap onto a second line on a phone. That changes where its
// ring sits against the characters beside it

/**
 * Guards the keyboard focus ring on a text link inside a sentence. It used to be drawn 2px outside the
 * link's text with a 2px gap, so it covered the full stop or word beside the link and read as if that
 * character were part of the link. Eight of the ten links that take the shared `app-inline-link` class are
 * reached here, since a link left out of the shared rule would keep the old ring. The bug report link in
 * FailureBlock and the refresh button in the transaction filters are not: no staged state
 * has shown either one yet, so they are left to a by-hand check
 */

type RingMeasure = {
  style: string
  width: number
  offset: number
  opaque: boolean
  /** The ring's outer edge past the link's last line, and where the next character starts, null with none after it */
  ringRight: number
  nextLeft: number | null
  /** The link's own box, from its first line's left edge to its last line's right edge */
  boxLeft: number
  boxRight: number
  /** The ring's inner edge on each end of the link, and where its own text starts and ends */
  ringInnerLeft: number
  ringInnerRight: number
  textLeft: number
  textRight: number
  /** The underline's lower edge and the ring's lower stroke's inner edge, on the link's last line */
  underlineBottom: number
  ringInnerBottom: number
}

/** Tabs to the link from the control before it, so it takes the focus the way a keyboard user does */
async function tabTo(page: Page, link: Locator): Promise<void> {
  await link.focus()
  await page.keyboard.press('Shift+Tab')
  // A link that is the page's only tab stop sends the focus out of the page and back. That takes a second Tab
  await page.keyboard.press('Tab')
  if (!(await link.evaluate((node) => node === document.activeElement))) await page.keyboard.press('Tab')
  await expect(link).toBeFocused()
}

/**
 * Reads the focused link's ring once it has faded in, and the character that follows the link in its
 * sentence. A link that wraps is drawn as one box per line, so the ring's start is read from the first and its
 * end from the last
 */
async function readRing(link: Locator): Promise<RingMeasure> {
  await expect.poll(() => link.evaluate((node) => Number(getComputedStyle(node).outlineColor.match(/[\d.]+/g)?.[3] ?? 1)))
    .toBe(1)
  return link.evaluate((node) => {
    const style = getComputedStyle(node)
    const rects = Array.from(node.getClientRects())
    const first = rects[0]
    const last = rects[rects.length - 1]
    const next = node.nextSibling
    let nextLeft: number | null = null
    if (next && next.nodeType === Node.TEXT_NODE && next.textContent) {
      const range = document.createRange()
      range.setStart(next, 0)
      range.setEnd(next, 1)
      const box = range.getBoundingClientRect()
      // A character on the next line is not beside the link, so only one whose middle falls within the
      // height of the link's own text counts
      const middle = (box.top + box.bottom) / 2
      if (middle > last.top + parseFloat(style.paddingTop) && middle < last.bottom - parseFloat(style.paddingBottom)) {
        nextLeft = box.left
      }
    }
    const offset = parseFloat(style.outlineOffset)
    const width = parseFloat(style.outlineWidth)
    return {
      style: style.outlineStyle,
      width,
      offset,
      opaque: Number(style.outlineColor.match(/[\d.]+/g)?.[3] ?? 1) === 1,
      ringRight: last.right + offset + width,
      nextLeft,
      boxLeft: first.left,
      boxRight: last.right,
      ringInnerLeft: first.left - offset,
      ringInnerRight: last.right + offset,
      textLeft: first.left + parseFloat(style.paddingLeft),
      textRight: last.right - parseFloat(style.paddingRight),
      // The underline is a background gradient, so its place is the computed background position within the
      // content box, whose top is the box's top plus its padding, and its thickness is the background's height
      underlineBottom: last.top + parseFloat(style.paddingTop) + parseFloat(style.backgroundPositionY) +
        parseFloat(style.backgroundSize.split(' ')[1]),
      ringInnerBottom: last.bottom + offset,
    }
  })
}

async function expectRingInItsOwnRoom(page: Page, link: Locator): Promise<void> {
  await expect(link).toBeVisible()
  await tabTo(page, link)
  const ring = await readRing(link)
  expect(ring.style).toBe('solid')
  expect(ring.width).toBe(2)
  expect(ring.opaque).toBe(true)
  if (ring.nextLeft !== null) {
    expect(ring.ringRight, `the ring reaches ${ring.ringRight}px and the next character starts at ${ring.nextLeft}px`)
      .toBeLessThanOrEqual(ring.nextLeft)
  }
  // The ring's outer edge stays inside the link's own box on both ends. This is what fails for a link without
  // the shared class, where the ring is drawn 2px outside the box and over the characters beside it, including
  // a link with nothing after it
  expect(ring.ringInnerLeft - ring.width, 'the ring starts inside the link\'s box').toBeGreaterThanOrEqual(ring.boxLeft)
  expect(ring.ringRight, 'the ring ends inside the link\'s box').toBeLessThanOrEqual(ring.boxRight)
  // The ring has its own room beside the text, so it does not run through the link's first and last letters
  expect(ring.ringInnerLeft, 'the ring is outside the first letter').toBeLessThanOrEqual(ring.textLeft)
  expect(ring.ringInnerRight, 'the ring is outside the last letter').toBeGreaterThanOrEqual(ring.textRight)
  // The ring's lower stroke leaves a visible gap under the underline instead of running along it
  expect(ring.ringInnerBottom - ring.underlineBottom, 'the gap between the underline and the ring').toBeGreaterThanOrEqual(2)
}

/**
 * Expects the link's room not to change the height of what holds it. Without the class the link is what it
 * was before the fix, so the two heights are the line box as it was and as it is. Run last, since it
 * strips the class
 */
async function expectLineHeightUnchanged(link: Locator): Promise<void> {
  const heights = await link.evaluate((node) => {
    const holder = node.parentElement!
    const withRoom = holder.getBoundingClientRect().height
    node.classList.remove('app-inline-link')
    const before = holder.getBoundingClientRect().height
    node.classList.add('app-inline-link')
    return { withRoom, before }
  })
  expect(heights.withRoom, 'the height of the text holding the link').toBe(heights.before)
}

/** Reaches a link and returns it, the way a user would find it */
type Reach = (page: Page, request: APIRequestContext) => Promise<Locator>

async function signedIn(page: Page, request: APIRequestContext) {
  await logInViaApi(page, await signUpUser(request))
}

const LINKS: { name: string; reach: Reach }[] = [
  {
    name: 'the setup guide on Settings',
    reach: async (page, request) => {
      await signedIn(page, request)
      await openPage(page, '/settings#security')
      return page.getByRole('link', { name: 'See the setup guide', exact: true })
    },
  },
  {
    name: 'the Actual Budget export guide',
    reach: async (page, request) => {
      await signedIn(page, request)
      await openPage(page, '/settings/imports')
      await chooseFromDropdown(page.locator('body'), 'Data source', 'Actual Budget')
      return page.getByRole('link', { name: 'guide to exporting data', exact: true })
    },
  },
  {
    name: 'the Firefly III export guide',
    reach: async (page, request) => {
      await signedIn(page, request)
      await openPage(page, '/settings/imports')
      await chooseFromDropdown(page.locator('body'), 'Data source', 'Firefly III')
      return page.getByRole('link', { name: 'guide to exporting data', exact: true })
    },
  },
  {
    name: 'the retry button when the currency list fails to load on sign-up',
    reach: async (page) => {
      await page.route(`${API_BASE_URL}/currencies`, (route) => route.abort())
      await page.goto('/signup')
      return page.getByRole('button', { name: 'Retry loading currencies', exact: true })
    },
  },
  {
    name: 'the full import page link on an import into one account',
    reach: async (page, request) => {
      const user = await signUpUser(request)
      const account = await createAccount(request, user, { name: 'Checking', currency: 'CAD' })
      await logInViaApi(page, user)
      await openPage(page, `/settings/imports?account=${account.id}`)
      return page.getByRole('link', { name: 'Open the full import page', exact: true })
    },
  },
  {
    name: 'the credit widget\'s choose button with no account chosen',
    reach: async (page, request) => {
      const user = await signUpUser(request)
      await createAccount(request, user, {
        name: 'Card A',
        accountKind: 'revolving',
        accountType: 'credit_card',
        startingBalance: -50_000,
        creditLimit: 500_000,
      })
      await logInViaApi(page, user)
      await openPage(page, '/dashboard')
      await page.getByRole('button', { name: 'Choose credit accounts' }).click()
      const dialog = page.getByRole('dialog', { name: 'Credit utilization' })
      await dialog.getByRole('checkbox', { name: 'Card A' }).click()
      await dialog.getByRole('button', { name: 'Save' }).click()
      await expect(dialog).toBeHidden()
      return page.getByRole('button', { name: 'Choose a credit account', exact: true })
    },
  },
  {
    name: 'the sign-up button under the login form',
    reach: async (page) => {
      await page.goto('/login')
      return page.getByRole('button', { name: 'Sign up', exact: true })
    },
  },
  {
    name: 'the back to login button on provider sign-up',
    reach: async (page) => {
      const code = `e2e-code-${crypto.randomUUID()}`
      const state = `e2e-state-${crypto.randomUUID()}`
      await page.route(`${API_BASE_URL}/auth/oidc/callback`, async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        await route.fulfill({
          status: 200,
          json: {
            onboarding_required: true,
            onboarding_token: `e2e-token-${crypto.randomUUID()}`,
            email: `e2e-oidc-${crypto.randomUUID()}@example.com`,
            first_name: 'Link',
            last_name: null,
          },
        })
      })
      await page.goto(`/auth/oidc/callback?${new URLSearchParams({ code, state })}`)
      return page.getByText('Wrong account?').locator('button')
    },
  },
]

test.describe('text links in a sentence', () => {
  for (const { name, reach } of LINKS) {
    test(`keep their focus ring in its own room, as ${name} does`, AT_EVERY_SIZE, async ({ page, request }) => {
      const link = await reach(page, request)
      await expectRingInItsOwnRoom(page, link)
      await expectLineHeightUnchanged(link)
    })
  }

  test('leave the ring on a link of its own as it was', AT_EVERY_SIZE, async ({ page }) => {
    await page.goto('/login')
    const link = page.getByRole('button', { name: 'Forgot password?', exact: true })
    await expect(link).toBeVisible()
    await tabTo(page, link)
    const ring = await link.evaluate((node) => {
      const style = getComputedStyle(node)
      return { style: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset }
    })
    expect(ring).toEqual({ style: 'solid', width: '2px', offset: '2px' })
  })
})
