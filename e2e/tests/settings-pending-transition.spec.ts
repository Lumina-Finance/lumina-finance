import { test, type Locator, type Page } from '@playwright/test'

import { asUser, createCategory, createTaxAdvantagedCategory, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { checkIconSwap } from '../support/buttonFrames'
import { API_BASE_URL } from '../support/target'

// Runs at 390px and 1280px wide, both set here. The settings lists draw their edit and delete confirmations
// as icon buttons that give way to the spinner, and the tax-advantaged dialogues as buttons with a label

const SIZES = [{ width: 390, height: 844 }, { width: 1280, height: 800 }]

type Request = Parameters<typeof signUpUser>[0]

interface IconCase {
  name: string
  request: { method: string; path: string }
  open: (page: Page, request: Request, user: TestUser) => Promise<Locator>
}

async function createNamed(request: Request, user: TestUser, path: string, name: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}${path}`, { headers: asUser(user), data: { name } })
  if (response.status() !== 201) throw new Error(`creating ${name} answered ${response.status()}`)
  return ((await response.json()) as { id: string }).id
}

const ICON_CASES: IconCase[] = [
  {
    name: 'the tag save button',
    request: { method: 'PATCH', path: '/tags/*' },
    open: async (page, request, user) => {
      await createNamed(request, user, '/tags', 'Holiday')
      await logInViaApi(page, user)
      await openPage(page, '/settings#tags')
      const section = page.locator('#tags')
      await section.getByRole('button', { name: 'Edit Holiday', exact: true }).click()
      await section.getByRole('textbox', { name: 'Holiday name', exact: true }).fill('Holidays')
      return section.getByRole('button', { name: 'Save Holiday', exact: true })
    },
  },
  {
    name: 'the tag delete confirmation',
    request: { method: 'DELETE', path: '/tags/*' },
    open: async (page, request, user) => {
      await createNamed(request, user, '/tags', 'Holiday')
      await logInViaApi(page, user)
      await openPage(page, '/settings#tags')
      const section = page.locator('#tags')
      await section.getByRole('button', { name: 'Delete Holiday', exact: true }).click()
      return section.getByRole('button', { name: 'Confirm delete Holiday', exact: true })
    },
  },
  {
    name: 'the merchant save button',
    request: { method: 'PATCH', path: '/merchants/*' },
    open: async (page, request, user) => {
      await createNamed(request, user, '/merchants', 'Corner Shop')
      await logInViaApi(page, user)
      await openPage(page, '/settings#merchants')
      const section = page.locator('#merchants')
      await section.getByRole('button', { name: 'Edit Corner Shop', exact: true }).click()
      await section.getByRole('textbox', { name: 'Corner Shop name', exact: true }).fill('Corner Store')
      return section.getByRole('button', { name: 'Save Corner Shop', exact: true })
    },
  },
  {
    name: 'the merchant delete confirmation',
    request: { method: 'DELETE', path: '/merchants/*' },
    open: async (page, request, user) => {
      await createNamed(request, user, '/merchants', 'Corner Shop')
      await logInViaApi(page, user)
      await openPage(page, '/settings#merchants')
      const section = page.locator('#merchants')
      await section.getByRole('button', { name: 'Delete Corner Shop', exact: true }).click()
      return section.getByRole('button', { name: 'Confirm delete Corner Shop', exact: true })
    },
  },
  {
    name: 'the category save button',
    request: { method: 'PATCH', path: '/categories/*' },
    open: async (page, request, user) => {
      await createCategory(request, user, { name: 'Zoo trips' })
      await logInViaApi(page, user)
      await openPage(page, '/settings#categories')
      const section = page.locator('#categories')
      await section.getByPlaceholder('Search categories...').fill('Zoo trips')
      await section.getByRole('button', { name: /^Expense/ }).click()
      await section.getByRole('button', { name: 'Edit Zoo trips', exact: true }).click()
      await section.getByRole('textbox', { name: 'Zoo trips name', exact: true }).fill('Zoo visits')
      return section.getByRole('button', { name: 'Save Zoo trips', exact: true })
    },
  },
  {
    name: 'the category delete confirmation',
    request: { method: 'DELETE', path: '/categories/*' },
    open: async (page, request, user) => {
      await createCategory(request, user, { name: 'Zoo trips' })
      await logInViaApi(page, user)
      await openPage(page, '/settings#categories')
      const section = page.locator('#categories')
      await section.getByPlaceholder('Search categories...').fill('Zoo trips')
      await section.getByRole('button', { name: /^Expense/ }).click()
      await section.getByRole('button', { name: 'Delete Zoo trips', exact: true }).click()
      return section.getByRole('button', { name: 'Confirm delete Zoo trips', exact: true })
    },
  },
]

for (const kind of ICON_CASES) {
  for (const size of SIZES) {
    test(`fades ${kind.name}'s icon and spinner at ${size.width}px wide`, async ({ page, request }) => {      await page.setViewportSize(size)
      const user = await signUpUser(request)
      const button = await kind.open(page, request, user)
      await checkIconSwap(page, button, kind.request)
    })
  }
}

async function openTaxCategory(page: Page, request: Request, withLimit: boolean): Promise<Locator> {
  const user = await signUpUser(request)
  const categoryId = await createTaxAdvantagedCategory(request, user, 'Retirement Savings')
  if (withLimit) {
    const limit = await request.post(`${API_BASE_URL}/tax-advantaged-categories/${categoryId}/limits`, {
      headers: asUser(user),
      data: { year: 2026, contribution_limit: 700000 },
    })
    if (limit.status() !== 201) throw new Error(`creating the limit answered ${limit.status()}`)
  }
  await logInViaApi(page, user)
  await openPage(page, '/settings#tax-advantaged-categories')
  await page.getByRole('row').filter({ hasText: 'Retirement Savings' }).click()
  return page.getByRole('dialog', { name: 'Retirement Savings', exact: true })
}

for (const size of SIZES) {
  test(`fades the tax-advantaged category dialogue's delete button at ${size.width}px wide`, async ({ page, request }) => {    await page.setViewportSize(size)
    const category = await openTaxCategory(page, request, false)
    // The first press asks to confirm and the second sends the request, from the same button
    const remove = category.locator('button.app-danger-button')
    await remove.click()
    // A refused request puts the button back to asking, so a later round needs both presses
    const press = async () => {
      await remove.click()
      await page.waitForTimeout(400)
      if (await remove.isEnabled()) await remove.click()
    }
    await checkIconSwap(page, remove, { method: 'DELETE', path: '/tax-advantaged-categories/*' }, press)
  })

  test(`fades the tax-advantaged year dialogue's save button at ${size.width}px wide`, async ({ page, request }) => {    await page.setViewportSize(size)
    const category = await openTaxCategory(page, request, false)
    await category.getByRole('button', { name: 'Add year', exact: true }).click()
    const year = page.getByRole('dialog').filter({ has: page.getByLabel('New tax year') }).last()
    await year.getByLabel('New tax year').fill('2027')
    await year.getByLabel('New tax-year contribution limit').fill('7000')
    // This button keeps its width while pending, so only the label and spinner fade
    await checkIconSwap(page, year.locator('button.app-primary-button').last(),
      { method: 'POST', path: '/tax-advantaged-categories/*/limits' }, undefined, ':scope > div:not(:has(.app-spinner))')
  })
}

for (const size of SIZES) {
  test(`fades the profile pane's save button at ${size.width}px wide`, async ({ page, request }) => {
    await page.setViewportSize(size)
    const user = await signUpUser(request)
    await logInViaApi(page, user)
    await openPage(page, '/settings#profile')
    const profile = page.locator('#profile')
    await profile.getByLabel('First name').fill('Hand')
    // The pending button is named Saving, so it is found by its class, not its name. It keeps its width while
    // pending, so only the label and spinner fade
    await checkIconSwap(page, profile.locator('button.app-primary-button').last(),
      { method: 'PATCH', path: '/me' }, undefined, ':scope > div:not(:has(.app-spinner))', { staysEnabled: true })
  })
}

for (const size of SIZES) {
  test(`fades the category details dialogue's save button at ${size.width}px wide`, async ({ page, request }) => {
    await page.setViewportSize(size)
    const category = await openTaxCategory(page, request, false)
    await category.getByRole('button', { name: 'Edit', exact: true }).click()
    const details = page.getByRole('dialog', { name: 'Category details', exact: true })
    await details.getByLabel('Category name').fill('Retirement Pot')
    // This button is named Saving while pending, so it is found by its class
    await checkIconSwap(page, details.locator('button.app-primary-button').last(),
      { method: 'PATCH', path: '/tax-advantaged-categories/*' }, undefined, ':scope > div:not(:has(.app-spinner))')
  })
}

// The limit rows draw their delete control from 750px wide, so this runs at desktop width alone
test('fades the tax-advantaged limit delete button at 1280px wide', async ({ page, request }) => {
  await page.setViewportSize(SIZES[1])
  const category = await openTaxCategory(page, request, true)
  // The control is named for what it asks, so it is found by what both names end with
  const remove = category.locator('button[aria-label$="2026 limits"]:visible')
  // The first press asks to confirm, and the second sends the request. A refused request puts the control back
  // to asking, so each round starts with both
  const press = async () => {
    if ((await remove.getAttribute('aria-label')) === 'Delete 2026 limits') {
      await remove.click()
      await page.waitForTimeout(600)
    }
    await remove.click()
  }
  await checkIconSwap(page, remove, { method: 'DELETE', path: '/tax-advantaged-categories/*/limits/*' }, press,
    ':scope > div:not(:has(.app-spinner))')
})
