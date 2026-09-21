import { expect, type Locator, type Page, type Request, type Route } from '@playwright/test'

import { API_BASE_URL } from './target'

const NO_CONTENT_STATUS = 204

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

/** Assert a scoped row remains named and has exactly one rendered responsive amount */
export async function expectTransactionRow(page: Page, id: string, amount: string): Promise<void> {
  const row = page.getByTestId(`transaction-row-${id}`)
  await expect(row).toBeVisible()
  await expect(row).toHaveRole('button')
  await expect(row).toHaveAccessibleName(new RegExp(amount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  const amounts = row.getByTestId('transaction-amount')
  await expect(amounts).toHaveCount(3)
  const visibleAmount = amounts.filter({ visible: true })
  await expect(visibleAmount).toHaveCount(1)
  await expect(visibleAmount).toHaveText(amount)
}
