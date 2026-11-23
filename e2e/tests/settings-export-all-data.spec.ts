import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

import { signUpUser, todayInTestTimezone } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only: it sets the 1280px and 390px widths it checks itself

// The archive's contents are the backend's tests. These cover the Export all data item in the settings menus

const EXPORT_BUTTON = { name: 'Export all data', exact: true } as const

test('saves the archive of everything the user owns, named for the day', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')

  const downloadStarted = page.waitForEvent('download')
  await page.getByRole('button', EXPORT_BUTTON).click()
  const download = await downloadStarted

  expect(download.suggestedFilename()).toBe(`lumina-finance-export-${todayInTestTimezone()}.zip`)

  // Every ZIP file opens with these two letters, so a saved error page or an empty file fails here
  const saved = await readFile((await download.path())!)
  expect(saved.subarray(0, 2).toString('latin1')).toBe('PK')
  await expect(page.getByRole('button', EXPORT_BUTTON)).toHaveAttribute('aria-busy', 'false')
})

test('says nothing was downloaded when the export fails, and the button works again', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')
  let downloads = 0
  page.on('download', () => (downloads += 1))

  await page.route('**/me/export', (route) => route.fulfill({ status: 500, body: 'boom' }))
  await page.getByRole('button', EXPORT_BUTTON).click()

  await expect(
    page.getByText('Oops, something went wrong and nothing was downloaded. Please try again.', { exact: true }),
  ).toBeVisible()
  expect(downloads).toBe(0)
  await expect(page.getByRole('button', EXPORT_BUTTON)).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('button', EXPORT_BUTTON)).toBeEnabled()
})

test('sits under Import in the settings sidebar, at its width', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')

  const importBox = (await page.getByRole('button', { name: 'Import', exact: true }).boundingBox())!
  const exportButton = page.getByRole('button', EXPORT_BUTTON)
  const exportBox = (await exportButton.boundingBox())!
  expect(exportBox.y).toBeGreaterThan(importBox.y + importBox.height - 1)
  expect(exportBox.x).toBe(importBox.x)
  expect(exportBox.width).toBe(importBox.width)
})

// The compact menu unmounts its items when it closes, so the page has to own a download already started
test('finishes the download after the compact settings menu closes', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')

  let releaseExport = () => {}
  const held = new Promise<void>((resolve) => (releaseExport = resolve))
  await page.route('**/me/export', async (route) => {
    await held
    await route.continue()
  })

  const menuToggle = page.locator('[aria-controls="settings-mobile-section-menu"]')
  await menuToggle.click()
  const menu = page.locator('#settings-mobile-section-menu')
  const importBox = (await menu.getByRole('button', { name: 'Import', exact: true }).boundingBox())!
  const exportButton = menu.getByRole('button', EXPORT_BUTTON)
  expect((await exportButton.boundingBox())!.y).toBeGreaterThan(importBox.y + importBox.height - 1)

  await exportButton.click()
  await expect(exportButton).toHaveAttribute('aria-busy', 'true')
  await menuToggle.click()
  await expect(menu).toBeHidden()

  const downloadStarted = page.waitForEvent('download')
  releaseExport()
  const download = await downloadStarted
  expect(download.suggestedFilename()).toBe(`lumina-finance-export-${todayInTestTimezone()}.zip`)
})

// A refusal the server gave no words for says what the shared wording says, not what the transactions export says
test('names a refused export in the shared words', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')

  await page.route('**/me/export', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
  await page.getByRole('button', EXPORT_BUTTON).click()

  await expect(
    page.getByText('Nothing was downloaded: the request was refused. Please refresh the page and try again.', { exact: true }),
  ).toBeVisible()
})
