import { expect, test, type Page } from '@playwright/test'

import { asUser, createAccount, signUpUser } from '../support/api'
import { commitImport, leaveImportSetup, logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: what the import sends and writes is the same at every size

// The Tags column names three tags the user has no tag for and one they have, in other capitals. The
// Labels column holds other names, so mapping it in place of Tags is a different set of questions
const CSV = [
  'Date,Amount,Category,Tags,Labels',
  '2024-03-15,-42.50,Groceries,TRAVEL|Junk,work',
  '2024-03-16,-12.00,Groceries,Trip,work',
  '2024-03-17,-30.00,Groceries,holiday,play',
].join('\n')

type StagedBatch = { tags: Record<string, unknown>[] }

async function openTagStep(page: Page, request: Parameters<typeof signUpUser>[0], csv = CSV) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  const created = await request.post(`${API_BASE_URL}/tags`, { headers: asUser(user), data: { name: 'Holiday' } })
  expect(created.status()).toBe(201)
  const holiday = (await created.json()) as { id: string }
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'tags.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  const step = page.locator('section').filter({ has: page.getByText('Tag matching', { exact: true }) }).last()
  const rowFor = (source: string) => step.getByRole('row').filter({ has: page.getByText(source, { exact: true }) })

  // The tag the file's holiday matches has arrived once its row reads Holiday
  await expect(rowFor('holiday').getByRole('combobox')).toContainText('Holiday')
  await leaveImportSetup(page)

  // The name box of a row, which its dropdown's search box would also answer to while it closes
  const nameBoxOf = (source: string) => rowFor(source).getByRole('textbox', { name: `Name for the tag created from ${source}` })

  // Picks an answer in a row's dropdown and waits for its list to leave the page
  const answer = async (source: string, option: string | RegExp) => {
    await rowFor(source).getByRole('combobox').click()
    await page.getByRole('option', { name: option, exact: typeof option === 'string' }).click()
    await expect(page.getByRole('listbox')).toHaveCount(0)
  }
  return { user, holiday, step, rowFor, nameBoxOf, answer }
}

test('sends each tag answer, including a corrected name typed on a row nobody answered, and files the rows under them', async ({ page, request }) => {
  const { user, holiday, rowFor, nameBoxOf, answer } = await openTagStep(page, request)

  // TRAVEL matches nothing, so its row reads as creating a tag and typing a name answers it. The same
  // name in other capitals is a correction, since the file's own capitals would be written without it
  await expect(rowFor('TRAVEL').getByRole('combobox')).toContainText('Create new tag')
  await nameBoxOf('TRAVEL').fill('Travel')

  await answer('Junk', /^Skip/)
  await expect(nameBoxOf('Junk')).toBeDisabled()

  await answer('Trip', 'Holiday')
  await expect(rowFor('Trip').getByRole('combobox')).toContainText('Holiday')

  // The name matched in other capitals is left alone, filed under the tag it matches
  await expect(rowFor('holiday').getByRole('combobox')).toContainText('Holiday')
  await expect(nameBoxOf('TRAVEL')).toHaveValue('Travel')

  // The preview shows the tags the rows will carry: the corrected name, the tag chosen and none
  // for the skipped name
  const preview = page.locator('section').filter({ has: page.getByText('Preview and commit', { exact: true }) }).last()
  await expect(preview).toContainText('Travel')
  await expect(preview).toContainText('Holiday')
  for (const fileName of ['Junk', 'TRAVEL', 'Trip', 'holiday']) await expect(preview).not.toContainText(fileName)

  const staged = page.waitForRequest((sent) => sent.method() === 'POST' && /\/transactions\/import\/runs\/[^/]+\/rows$/.test(sent.url()))
  const response = await commitImport(page)
  expect(response.status()).toBe(201)

  // Only the answers differing from what the commit does unasked are sent: the matched name is not
  const { tags } = (await staged).postDataJSON() as StagedBatch
  expect([...tags].sort((a, b) => String(a.source).localeCompare(String(b.source)))).toEqual([
    { source: 'Junk', skip: true },
    { source: 'TRAVEL', create: { name: 'Travel' } },
    { source: 'Trip', tag_id: holiday.id },
  ])

  const tagList = await request.get(`${API_BASE_URL}/tags`, { headers: asUser(user) })
  expect((await tagList.json() as { name: string }[]).map((tag) => tag.name).sort()).toEqual(['Holiday', 'Travel'])
  const transactions = await request.get(`${API_BASE_URL}/transactions`, { headers: asUser(user) })
  const carried = (await transactions.json() as { tags: { name: string }[] }[]).map((transaction) => transaction.tags.map((tag) => tag.name))
  expect(carried.map((names) => names.join()).sort()).toEqual(['Holiday', 'Holiday', 'Travel'])
})

test('holds the tag answers under the column they were given for', async ({ page, request }) => {
  const { step, rowFor, nameBoxOf, answer } = await openTagStep(page, request)
  await answer('Junk', /^Skip/)
  await expect(rowFor('Junk').getByRole('combobox')).toContainText('Skip')

  // Maps a file column to an app field, waiting for the list to leave the page
  const mapColumn = async (column: string, field: string | RegExp) => {
    await page.getByRole('combobox', { name: `Match to app field ${column}`, exact: true }).click()
    await page.getByRole('option', { name: field, exact: typeof field === 'string' }).click()
    await expect(page.getByRole('listbox')).toHaveCount(0)
  }

  // Reading the tags from the Labels column asks about its names, none of them answered
  await mapColumn('Tags', 'Do not import')
  await mapColumn('Labels', /^Tags\b/)
  await expect(rowFor('work').getByRole('combobox')).toContainText('Create new tag')
  await expect(step.getByText('Junk', { exact: true })).toHaveCount(0)

  // Putting the Tags column back brings back the answer given for it rather than asking again
  await mapColumn('Labels', 'Do not import')
  await mapColumn('Tags', /^Tags\b/)
  await expect(rowFor('Junk').getByRole('combobox')).toContainText('Skip')
  await expect(nameBoxOf('Junk')).toBeDisabled()
})

test('marks a new tag\'s name invalid while it is blank or over 64 characters, and refuses the import', async ({ page, request }) => {
  const { rowFor } = await openTagStep(page, request)
  const name = rowFor('Trip').getByRole('textbox', { name: 'Name for the tag created from Trip' })
  await expect(name).not.toHaveAttribute('aria-invalid', 'true')

  await name.fill('')
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeDisabled()

  await name.fill('t'.repeat(65))
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeDisabled()

  await name.fill('t'.repeat(64))
  await expect(name).not.toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeEnabled()
})

test('lists a row whose tag is over 64 characters as one that will not import, and imports the others', async ({ page, request }) => {
  const longTag = 'x'.repeat(100_000)
  const csv = `${CSV}\n2024-03-18,-5.00,Groceries,${longTag},play`
  const { user, step, rowFor } = await openTagStep(page, request, csv)

  // The long name is not asked about, so the matches settled for the others and it has no row
  await expect(rowFor('TRAVEL')).toBeVisible()
  await expect(step.getByText('x'.repeat(29))).toHaveCount(0)

  const preview = page.locator('section').filter({ has: page.getByText('Preview and commit', { exact: true }) }).last()
  await expect(preview.getByText('1 row will not be imported', { exact: true })).toBeVisible()
  await expect(preview).toContainText(`The tag "${'x'.repeat(28)}…" is longer than 64 characters.`)

  // The row's own cell is cut too, so the page never holds the whole name
  await expect(preview).toContainText('x'.repeat(200) + '…')
  await expect(preview).not.toContainText('x'.repeat(201))

  const response = await commitImport(page)
  expect(response.status()).toBe(201)
  const transactions = await request.get(`${API_BASE_URL}/transactions`, { headers: asUser(user) })
  expect(await transactions.json()).toHaveLength(3)
})
