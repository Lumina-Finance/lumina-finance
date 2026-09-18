import { expect, type Locator, type Page, type Route } from '@playwright/test'

import { API_BASE_URL } from './target'

/** Assert identity selection still finds an accessible pending action */
export async function expectPendingAction(action: Locator, name: string): Promise<void> {
  await expect(action).toHaveRole('button')
  await expect(action).toHaveAccessibleName(name)
  await expect(action).toBeDisabled()
  await expect(action).toHaveAttribute('aria-busy', 'true')
}

/** Hold an own-resource mutation while asserting pending UI, then continue the real request */
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
  const held = new Promise<void>((resolve) => { release = resolve })
  const finished = new Promise<void>((resolve) => { markFinished = resolve })
  const url = `${API_BASE_URL}${path}`

  /** Match the mutation's method and synthetic record before holding its network request */
  const handler = async (route: Route): Promise<void> => {
    const request = route.request()
    if (request.method() !== method) {
      await route.continue()
      return
    }
    if (body) {
      const data = request.postDataJSON() as Record<string, unknown>
      if (!Object.entries(body).every(([key, value]) => data[key] === value)) {
        await route.continue()
        return
      }
    }
    intercepted = true
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
  } finally {
    release()
    if (intercepted) await finished
    if (!page.isClosed()) {
      try {
        await page.unroute(url, handler)
      } catch (error) {
        if (!page.isClosed()) throw error
      }
    }
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
