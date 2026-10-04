import { expect, type Locator, type Page, type Request, type Route } from '@playwright/test'

import { API_BASE_URL } from './target'

const NO_CONTENT_STATUS = 204

/** The true minus sign the app puts before an amount that moved out, which a hyphen never matches */
export const MINUS = String.fromCodePoint(0x2212)

/** Assert identity selection still finds an accessible pending action */
export async function expectPendingAction(action: Locator, name: string): Promise<void> {
  await expect(action).toHaveRole('button')
  await expect(action).toHaveAccessibleName(name)
  await expect(action).toBeDisabled()
  await expect(action).toHaveAttribute('aria-busy', 'true')
}

/** Hold an own-resource mutation while asserting pending UI, then await its real response */
export async function whileApiRequestHeld(
  page: Page,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  click: () => Promise<void>,
  checkPending: () => Promise<void>,
  body?: Record<string, string>,
): Promise<void> {
  let release!: () => void
  let markFinished!: () => void
  let intercepted = false
  let holding = true
  let mutation: Request | undefined
  const held = new Promise<void>((resolve) => { release = resolve })
  const finished = new Promise<void>((resolve) => { markFinished = resolve })
  const url = `${API_BASE_URL}${path}`

  /** Match the mutation's method and synthetic record before holding its network request */
  const handler = async (route: Route): Promise<void> => {
    const request = route.request()
    if (!holding || request.method() !== method) {
      await route.fallback()
      return
    }
    if (body) {
      const data = request.postDataJSON() as Record<string, unknown>
      if (!Object.entries(body).every(([key, value]) => data[key] === value)) {
        await route.fallback()
        return
      }
    }
    intercepted = true
    mutation = request
    try {
      await held
      await route.continue()
    } finally {
      markFinished()
    }
  }

  await page.route(url, handler)
  try {
    await click()
    await expect.poll(() => intercepted, { message: 'Own-resource mutation was intercepted' }).toBe(true)
    await checkPending()
    release()
    await finished

    // Dispatch is not completion, so start post-save UI checks only after the server answers
    const response = await mutation!.response()
    expect(response, 'The held mutation must receive a response').not.toBeNull()
    expect(response!.ok(), `The held mutation returned HTTP ${response!.status()}`).toBe(true)

    // Chromium does not reliably finish intercepted no-content responses through this API
    if (response!.status() !== NO_CONTENT_STATUS) {
      expect(await response!.finished(), 'The held mutation response must finish').toBeNull()
    }
  } finally {
    // Removing the last route here can race with the app's post-mutation refetches
    // Keep an inactive passthrough until this test's browser context is disposed
    holding = false
    release()
    if (intercepted) await finished
  }
}

/**
 * Find the button that opens a transaction row, given the row's content
 *
 * The button is the row's title, stretched over the row. Each responsive layout has its own title
 * and only the one on screen is exposed, where it comes before the controls beside it
 */
export function getTransactionRowButton(row: Locator): Locator {
  return row.getByRole('button').first()
}

/**
 * Assert keyboard focus on a control stretched over its row rings the row in the app's accent focus
 * outline, read from the layer the control lays over the row, which is what draws it
 */
export async function expectStretchedFocusRing(control: Locator): Promise<void> {
  await control.focus()

  // Back a step and forward again, so the focus arrives from the keyboard as a user's would
  await control.page().keyboard.press('Shift+Tab')
  await control.page().keyboard.press('Tab')
  await expect(control).toBeFocused()
  const ring = await control.evaluate((element) => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--app-accent)'
    element.append(probe)
    const accent = getComputedStyle(probe).color
    probe.remove()
    const layer = getComputedStyle(element, '::after')
    return { position: layer.position, style: layer.outlineStyle, width: layer.outlineWidth, color: layer.outlineColor, accent }
  })
  expect(ring).toEqual({ position: 'absolute', style: 'solid', width: '2px', color: ring.accent, accent: ring.accent })
}

/**
 * Assert a scoped row opens from a button named by its title alone and described by its amount, and
 * has exactly one rendered responsive amount
 *
 * A name holding the amount would mean the button is named by the whole row, which a screen reader
 * then reads twice, once as the button and once as the content. The description is what tabbing from
 * row to row hears of the amount
 */
export async function expectTransactionRow(page: Page, id: string, amount: string): Promise<void> {
  const row = page.getByTestId(`transaction-row-${id}`)
  await expect(row).toBeVisible()
  const button = getTransactionRowButton(row)
  const amountPattern = new RegExp(amount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  await expect(button).toBeVisible()
  await expect(button).toHaveAccessibleName(/\S/)
  await expect(button).not.toHaveAccessibleName(amountPattern)
  await expect(button).toHaveAccessibleDescription(amountPattern)
  const amounts = row.getByTestId('transaction-amount')
  await expect(amounts).toHaveCount(2)
  const visibleAmount = amounts.filter({ visible: true })
  await expect(visibleAmount).toHaveCount(1)
  await expect(visibleAmount).toHaveText(amount)
}
