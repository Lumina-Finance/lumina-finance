import { expect, test } from '@playwright/test'

import { createAccount, findReferenceId, signUpUser, todayInTestTimezone } from '../support/api'
import { openPage, logIn, waitForPageReady } from '../support/app'
import { API_BASE_URL } from '../support/target'

for (const mode of ['add', 'replace', 'clear'] as const) {
  test(`${mode} tags on the selected transactions without changing unselected rows`, async ({ page, request }) => {
    const user = await signUpUser(request)
    const headers = { Authorization: `Bearer ${user.accessToken}` }
    const account = await createAccount(request, user, { name: 'Tag editing account' })
    const archived = await createAccount(request, user, { name: 'Archived tag account' })
    const category = await findReferenceId(request, user, 'categories', 'Groceries')
    const merchant = await findReferenceId(request, user, 'merchants', 'Unknown')
    const tags: Record<string, string> = {}
    for (const name of ['Holiday', 'Family', 'Work', 'Reviewed']) {
      const response = await request.post(`${API_BASE_URL}/tags`, { headers, data: { name } })
      expect(response.status()).toBe(201)
      tags[name] = (await response.json() as { id: string }).id
    }

    /** Creates actual tagged rows so the browser must preserve different assignments on each row */
    async function record(names: string[], accountId = account.id, dt = todayInTestTimezone()) {
      const response = await request.post(`${API_BASE_URL}/transactions`, {
        headers,
        data: {
          account_id: accountId, category_id: category, merchant_id: merchant,
          dt, amount: -1000, currency: 'CAD', tag_ids: names.map((name) => tags[name]),
        },
      })
      expect(response.status()).toBe(201)
      return (await response.json() as { id: string }).id
    }

    const family = await record(['Holiday', 'Family'])
    const work = await record(['Holiday', 'Work'])
    const absent = await record(['Work'])
    const readOnly = await record(['Holiday'], archived.id)
    const unselected = await record(['Holiday', 'Family'], account.id, '2001-01-01')
    const archiveResponse = await request.patch(`${API_BASE_URL}/accounts/${archived.id}`, {
      headers, data: { is_archived: true },
    })
    expect(archiveResponse.status()).toBe(200)
    const archivedRows = await request.get(`${API_BASE_URL}/transactions?account_id=${archived.id}`, { headers })
    expect(archivedRows.status()).toBe(200)
    const archivedTransactions = await archivedRows.json() as { id: string; notes: string | null; amount: number }[]
    const adjustment = archivedTransactions.find((row) => row.notes === 'Account archived' && row.amount === 1000)
    expect(adjustment).toBeDefined()

    /** Reads persisted tags through the real API without relying on the compact row's tag-count display */
    async function readTags(id: string, expectedAmount = -1000) {
      const response = await request.get(`${API_BASE_URL}/transactions/${id}`, { headers })
      expect(response.status()).toBe(200)
      const transaction = await response.json() as { tags: { name: string }[]; amount: number }
      expect(transaction.amount).toBe(expectedAmount)
      return transaction.tags.map((tag) => tag.name).sort()
    }

    await logIn(page, user)
    await openPage(page, '/transactions')
    await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(6)
    await expect(page.getByTestId(`transaction-row-${adjustment!.id}`)).toBeVisible()
    await page.getByRole('button', { name: 'Select transactions', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: /^Select the transactions shown on / })).toHaveCount(2)
    await page.getByRole('checkbox', { name: /^Select the transactions shown on / }).first().check()
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(4)
    await expect(page.getByRole('checkbox', { disabled: true })).toHaveCount(2)
    await page.getByRole('button', { name: 'Edit the selected transactions', exact: true }).click()
    const edit = page.getByRole('dialog', { name: 'Edit 3 transactions', exact: true })
    await expect(edit).toBeVisible()
    const tagSelector = edit.getByRole('combobox', { name: 'Add a tag', exact: true })
    const override = edit.getByRole('checkbox', { name: 'Override existing tags', exact: true })
    await tagSelector.click()
    if (mode === 'clear' || mode === 'replace') {
      await page.getByRole('option', { name: 'Remove all tags', exact: true }).click()
      await expect(override).toBeChecked()
    }
    if (mode !== 'clear') {
      await page.getByRole('option', { name: 'Reviewed', exact: true }).click()
    }
    await tagSelector.press('Escape')
    const summaryLabel = mode === 'clear' ? 'Tags removed' : mode === 'replace' ? 'Tags replaced' : 'Tags added'
    const summaryValue = mode === 'clear' ? 'All tags' : 'Reviewed'
    await expect(edit.getByText(summaryLabel, { exact: true }).locator('..')).toContainText(summaryValue)
    if (mode === 'add') await expect(override).not.toBeChecked()

    const writes: unknown[] = []
    page.on('request', (sent) => {
      if (sent.method() === 'PATCH' && sent.url() === `${API_BASE_URL}/transactions/bulk`) {
        writes.push(sent.postDataJSON())
      }
    })
    await edit.getByRole('button', { name: 'Apply', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: 'Change 3 transactions?', exact: true })
    await expect(confirmation).toBeVisible()
    await expect(confirmation.getByText(summaryLabel, { exact: true })).toHaveCount(0)
    await expect(confirmation.getByText('This cannot be undone.', { exact: true })).toBeVisible()
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(confirmation).toBeHidden()
    expect(writes).toEqual([])
    expect(await readTags(family)).toEqual(['Family', 'Holiday'])
    expect(await readTags(work)).toEqual(['Holiday', 'Work'])

    await edit.getByRole('button', { name: 'Apply', exact: true }).click()
    const saved = page.waitForResponse((response) =>
      response.request().method() === 'PATCH' && response.url() === `${API_BASE_URL}/transactions/bulk`,
    )
    await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click()
    expect((await saved).status()).toBe(200)
    await expect(edit).toBeHidden()
    expect(writes).toHaveLength(1)
    const payload = writes[0] as { transaction_ids: string[]; override_tags?: boolean; add_tag_ids?: string[] }
    expect([...payload.transaction_ids].sort()).toEqual([family, work, absent].sort())
    expect(payload.override_tags).toBe(mode === 'add' ? undefined : true)
    expect(payload.add_tag_ids).toEqual(mode === 'clear' ? undefined : [tags.Reviewed])
    const expectedNames = mode === 'clear' ? [[], [], []] : mode === 'replace'
      ? [['Reviewed'], ['Reviewed'], ['Reviewed']]
      : [['Family', 'Holiday', 'Reviewed'], ['Holiday', 'Reviewed', 'Work'], ['Reviewed', 'Work']]
    for (const [index, id] of [family, work, absent].entries()) {
      expect(await readTags(id)).toEqual(expectedNames[index])
    }
    expect(await readTags(readOnly)).toEqual(['Holiday'])
    expect(await readTags(adjustment!.id, 1000)).toEqual([])
    expect(await readTags(unselected)).toEqual(['Family', 'Holiday'])

    // Reload after the updated query is durable, since the shared persister writes asynchronously
    await expect.poll(() => page.evaluate((ids) => {
      const raw = localStorage.getItem('lumina:query-cache')
      if (!raw) return null
      const persisted = JSON.parse(raw) as {
        clientState?: { queries?: {
          queryKey: unknown[]
          state: { data?: { pages?: { id: string; tags: { id: string }[] }[][] } }
        }[] }
      }
      const query = persisted.clientState?.queries?.find(({ queryKey }) =>
        queryKey[0] === 'transactions' && queryKey[1] === 'infinite'
        && JSON.stringify(queryKey[2]) === '{}' && queryKey[3] === 15,
      )
      const rows = query?.state.data?.pages?.flat() ?? []
      return ids.map((id) => rows.find((row) => row.id === id)?.tags.map((tag) => tag.id).sort() ?? null)
    }, [family, work, absent])).toEqual(expectedNames.map((names) => names.map((name) => tags[name]).sort()))

    await page.reload()
    await waitForPageReady(page)
    await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(6)
    for (const [index, id] of [family, work, absent].entries()) {
      expect(await readTags(id)).toEqual(expectedNames[index])
    }
  })
}
