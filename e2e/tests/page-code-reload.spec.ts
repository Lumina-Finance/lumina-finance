import { expect, test, type Page } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage, waitForPageReady } from '../support/app'

// Runs on desktop only: loading a page's code is the same at every size

// The files a deploy removes: the host answers each request for one with the app's HTML, as a
// single-page host does for any path it does not hold
const INSIGHTS_CODE = '**/assets/InsightsPage-*.js'
const APP_HTML = '<!doctype html><html><body><div id="root"></div></body></html>'

const recoveryScreen = (page: Page) => page.getByRole('heading', { name: 'OK this was not in the plan' })

/**
 * Remove the Insights page's code from this tab's view of the server
 *
 * @param page - Tab already open on the old build
 * @param stays - Whether it stays missing after a reload, as when nothing newer was deployed to hold it
 * @returns The number of requests for the missing code so far
 */
async function removeInsightsCode(page: Page, stays: boolean) {
  let requests = 0
  await page.route(INSIGHTS_CODE, async (route) => {
    requests += 1
    if (stays || requests === 1) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: APP_HTML })
    } else {
      await route.continue()
    }
  })
  return () => requests
}

/** Count the documents the tab loads after this call */
function countDocumentLoads(page: Page) {
  let loads = 0
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) loads += 1
  })
  return () => loads
}

async function openLink(page: Page, name: 'Dashboard' | 'Transactions' | 'Insights') {
  await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name, exact: true }).click()
}

async function openDashboard(page: Page) {
  const user = await signUpUser(page.request)
  await logInViaApi(page, user)
  await openPage(page, '/')
}

test('opens the page asked for after reloading onto the new build', async ({ page }) => {
  await openDashboard(page)
  const documentLoads = countDocumentLoads(page)
  const codeRequests = await removeInsightsCode(page, false)

  await openLink(page, 'Insights')

  await expect(page.getByRole('heading', { name: 'Insights', exact: true })).toBeVisible()
  await waitForPageReady(page)
  await expect(page).toHaveURL(/\/insights$/)
  expect(documentLoads()).toBe(1)
  expect(codeRequests()).toBe(2)
})

test('shows the error screen without reloading while offline', async ({ page }) => {
  await openDashboard(page)
  const documentLoads = countDocumentLoads(page)
  await removeInsightsCode(page, true)
  await page.context().setOffline(true)

  await openLink(page, 'Insights')

  // The screen is what a reload would have replaced, so it showing is the fence for the count
  await expect(recoveryScreen(page)).toBeVisible()
  expect(documentLoads()).toBe(0)
})

test('shows the error screen after one reload when the code is still missing', async ({ page }) => {
  await openDashboard(page)
  const documentLoads = countDocumentLoads(page)
  const codeRequests = await removeInsightsCode(page, true)

  await openLink(page, 'Insights')

  await expect(recoveryScreen(page)).toBeVisible()
  expect(documentLoads()).toBe(1)
  expect(codeRequests()).toBe(2)
})

test('keeps working on pages already loaded without reloading', async ({ page }) => {
  await openDashboard(page)
  await openLink(page, 'Transactions')
  await expect(page.getByRole('heading', { name: 'Transactions', exact: true })).toBeVisible()
  const documentLoads = countDocumentLoads(page)
  await removeInsightsCode(page, true)

  await openLink(page, 'Dashboard')
  await waitForPageReady(page)
  await openLink(page, 'Transactions')
  await expect(page.getByRole('heading', { name: 'Transactions', exact: true })).toBeVisible()

  expect(documentLoads()).toBe(0)
})
