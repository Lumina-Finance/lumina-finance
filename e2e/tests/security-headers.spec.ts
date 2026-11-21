import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

import { createAccount, createInstitution, signUpUser } from '../support/api'
import {
  addPasskeyAuthenticator,
  chooseFromDropdown,
  commitImport,
  expectSignedIn,
  logIn,
  logInViaApi,
  openPage,
  registerPasskeyOverApi,
} from '../support/app'
import { recordPolicyViolations } from '../support/contentSecurity'
import { stageFireflyExport } from '../support/firefly'
import { CAFE, PAYROLL, statementFile } from '../support/ofx'
import { needsOneAddress } from '../support/origins'
import { requestResetLink } from '../support/reset'
import { getAccountRow } from '../support/selectors'
import { API_BASE_URL, BASE_URL } from '../support/target'

// Runs on desktop only: the headers and what they refuse don't depend on the width

// A name is taken once per country across the database, so a retry in a new worker needs a name of its own
const RUN_TAG = crypto.randomUUID().slice(0, 8)

const ACTUAL_EXPORT = fileURLToPath(new URL('../fixtures/actual-yen/export.zip', import.meta.url))
const ACTUAL_MANIFEST = JSON.parse(
  readFileSync(new URL('../fixtures/actual-yen/manifest.json', import.meta.url), 'utf8'),
) as { rows: unknown[] }

// Every directive the policy sends and every source it allows, so a source added to any list fails.
// Connections are to the app's own origin alone, since nothing in this run names another one
const EXPECTED_POLICY = {
  'default-src': ["'none'"],
  // The app's own files, with WebAssembly for the Actual Budget importer and neither inline scripts
  // nor eval, so a script injected into a page has nothing to run it
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  // An institution's logo can be at any https address
  'img-src': ["'self'", 'https:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'frame-ancestors': ["'none'"],
}

// Passkeys work on the app's own pages, and every other feature the policy names is off
const EXPECTED_PERMISSIONS = [
  'publickey-credentials-get=(self)',
  'publickey-credentials-create=(self)',
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
]

function readDirectives(policy: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {}
  for (const [name, ...sources] of policy.split(';').map((directive) => directive.trim().split(/\s+/))) {
    if (name === '') continue
    // A browser enforces the first of two directives with one name and ignores the rest, so a second
    // one is refused here instead of read in place of the first
    expect(directives, `the policy names ${name} twice`).not.toHaveProperty(name)
    // A directive's sources mean the same in any order, so both sides sort them before comparing
    directives[name] = sources.toSorted()
  }
  return directives
}

async function readHeaders(page: Page, path: string): Promise<Record<string, string>> {
  const response = await page.request.get(`${BASE_URL}${path}`)
  expect(response.status()).toBe(200)
  return response.headers()
}

// The three tests below read what the packaged image's own web server sends at the app's address,
// the API beneath /api included. A stack that serves the app from another host sets its own headers
// and has no API under the app's address, so they leave a run against such a stack. The tests
// further down read the console for refusals and judge whatever policy the stack sends
const IMAGE_SERVER = needsOneAddress("reads the packaged image's web server, which a stack serving the app elsewhere replaces")

test('sends the policy with the app and the API, and runs no script it did not ship', IMAGE_SERVER, async ({ page }) => {
  for (const path of ['/', '/api/health']) {
    const headers = await readHeaders(page, path)

    expect(headers['x-frame-options'], `${path} may be framed`).toBe('DENY')
    expect(headers['x-content-type-options'], `${path} may be sniffed`).toBe('nosniff')
    expect(headers['referrer-policy'], `${path} sends its address to other sites`).toBe('no-referrer')
    expect(headers['strict-transport-security'], 'the image has no TLS to promise').toBeUndefined()

    // Compared in any order, as the policy's own directives are
    const permissions = (headers['permissions-policy'] ?? '').split(',').map((feature) => feature.trim())
    expect(permissions.toSorted(), `${path} switches on a feature the app doesn't use`).toEqual(EXPECTED_PERMISSIONS.toSorted())

    const policy = readDirectives(headers['content-security-policy'] ?? '')
    const expected = Object.fromEntries(Object.entries(EXPECTED_POLICY).map(([name, sources]) => [name, sources.toSorted()]))
    expect(policy, `${path} allows a source the app doesn't use`).toEqual(expected)
  }
})

test('refuses to be shown inside a frame', IMAGE_SERVER, async ({ page }) => {
  // The framing page is answered from the app's own address. The browser refuses a page on a made-up
  // site as a public page reaching into a local one, so the test would pass with no header at all.
  // The policy forbids every parent, the app's own address included, so this stands for any site
  await page.route(`${BASE_URL}/framing-page`, (route) =>
    route.fulfill({ contentType: 'text/html', body: `<iframe src="${BASE_URL}/login" title="app"></iframe>` }),
  )

  await page.goto(`${BASE_URL}/framing-page`)

  // A framed page that is refused is replaced by the browser's own error page
  await expect
    .poll(() => page.frames().map((frame) => frame.url()))
    .toContain('chrome-error://chromewebdata/')
  expect(page.frames().filter((frame) => frame.url().startsWith(`${BASE_URL}/login`))).toEqual([])
})

test('sends no address in the referrer when a link on the reset page leaves the app', IMAGE_SERVER, async ({ page, request }) => {
  const user = await signUpUser(request)
  const link = await requestResetLink(page, user.email)
  const token = new URL(link).searchParams.get('token')
  expect(token).toEqual(expect.any(String))

  let referrer: string | undefined = 'not requested'
  await page.route('https://elsewhere.example/**', (route) => {
    referrer = route.request().headers()['referer']
    return route.fulfill({ contentType: 'text/html', body: '<title>Elsewhere</title>' })
  })
  await page.goto(link)
  await expect(page.getByLabel('New password', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    const anchor = document.createElement('a')
    anchor.href = 'https://elsewhere.example/page'
    anchor.textContent = 'Leave the app'
    document.body.append(anchor)
  })

  await page.getByRole('link', { name: 'Leave the app' }).click()
  await expect(page).toHaveTitle('Elsewhere')

  expect(referrer).toBeUndefined()
})

test('signs in with a password with no policy violation', async ({ page, request }) => {
  const violations = recordPolicyViolations(page.context())
  const user = await signUpUser(request)

  await logIn(page, user)
  await expectSignedIn(page)
  await openPage(page, '/accounts')

  expect(violations).toEqual([])
})

test('signs in with a passkey with no policy violation', async ({ page, request }) => {
  const violations = recordPolicyViolations(page.context())
  const cdp = await addPasskeyAuthenticator(page)
  await cdp.send('Page.enable')
  const user = await signUpUser(request)
  await registerPasskeyOverApi(page, cdp, request, user, 'Laptop')

  await page.goto('/login')
  const signedIn = page.waitForResponse(
    (response) => response.url() === `${API_BASE_URL}/auth/passkeys/authenticate` && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
  expect((await signedIn).status()).toBe(200)
  await expectSignedIn(page)

  expect(violations).toEqual([])
})

test('signs in through a provider and receives its code with no policy violation', async ({ page, request }) => {
  const violations = recordPolicyViolations(page.context())
  const user = await signUpUser(request)
  const login = await request.post(`${API_BASE_URL}/auth/login`, { data: { email: user.email, password: user.password } })
  expect(login.status()).toBe(200)
  const session = await login.json()

  // The provider's own pages are another site's, so the test plays them: the app sends the browser
  // to the provider, and the provider sends it back to the app's callback with a code in the address
  await page.route(`${API_BASE_URL}/auth/oidc/providers`, (route) =>
    route.fulfill({ json: { providers: [{ slug: 'generic', display_name: 'Authentik' }] } }),
  )
  await page.route(`${API_BASE_URL}/auth/oidc/generic/authorize`, (route) =>
    route.fulfill({ json: { authorization_url: 'https://provider.example/authorize' } }),
  )
  await page.route('https://provider.example/authorize', (route) =>
    route.fulfill({ status: 302, headers: { location: `${BASE_URL}/auth/oidc/callback?code=a-code&state=a-state` } }),
  )
  let callbackBody: unknown
  await page.route(`${API_BASE_URL}/auth/oidc/callback`, (route) => {
    callbackBody = route.request().postDataJSON()
    return route.fulfill({ json: session })
  })

  await page.goto('/login')
  await page.getByRole('button', { name: 'Continue with Authentik' }).click()

  await expectSignedIn(page)
  expect(callbackBody).toEqual({ code: 'a-code', state: 'a-state' })
  expect(violations).toEqual([])
})

// Each way of bringing data in, staged as a user would. The Actual Budget one runs a database
// reader compiled to WebAssembly, so it is the only one that needs the policy's wasm source
const CSV = ['Date,Amount,Merchant', '2024-03-15,-42.50,Market', '2024-03-17,-18.25,Market'].join('\n')
const QIF = ['!Type:Bank', 'D3/15/2024', 'T-42.50', 'PMarket', '^'].join('\n')

async function openImports(page: Page, source?: string | RegExp) {
  await openPage(page, '/settings/imports')
  if (source) {
    await chooseFromDropdown(page.locator('body'), 'Data source', source)
    await expect(page.getByText('What to expect', { exact: true })).toBeVisible()
  }
}

test('reads a CSV, an OFX, a QIF and a Firefly III file with no policy violation', async ({ page, request }) => {
  const violations = recordPolicyViolations(page.context())
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openImports(page)

  await test.step('CSV', async () => {
    const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
    await expect(upload).toBeEnabled()
    await upload.setInputFiles({ name: 'bank.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })
    await expect(page.getByText('bank.csv', { exact: true })).toBeVisible()
  })

  await test.step('OFX', async () => {
    await openImports(page, 'OFX/QFX')
    const upload = page.locator('input[type="file"][accept*=".ofx"]')
    await expect(upload).toBeEnabled()
    await upload.setInputFiles(statementFile('statement.ofx', [CAFE, PAYROLL]))
    await expect(page.getByText('Corner Cafe', { exact: true }).first()).toBeVisible()
  })

  await test.step('QIF', async () => {
    await openImports(page, 'Quicken 3.0 (QIF)')
    const upload = page.locator('input[type="file"][accept=".qif"]')
    await expect(upload).toBeEnabled()
    await upload.setInputFiles({ name: 'household.qif', mimeType: 'application/octet-stream', buffer: Buffer.from(QIF) })
    await expect(page.getByText('household.qif', { exact: true })).toBeVisible()
  })

  await test.step('Firefly III', async () => {
    await stageFireflyExport(page)
    expect((await commitImport(page)).status()).toBe(201)
  })

  expect(violations).toEqual([])
})

test('imports an Actual Budget export with no policy violation', async ({ page, request }) => {
  const violations = recordPolicyViolations(page.context())
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openImports(page, 'Actual Budget')

  const upload = page.locator('input[type="file"][accept=".zip,.sqlite,application/zip"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles(ACTUAL_EXPORT)

  const response = await commitImport(page)
  expect(response.status()).toBe(201)
  expect(((await response.json()) as { transactions_created: number }).transactions_created).toBe(ACTUAL_MANIFEST.rows.length)
  expect(violations).toEqual([])
})

test('opens the category icon picker and picks an emoji with no policy violation', async ({ page, request }) => {
  const violations = recordPolicyViolations(page.context())
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#categories')
  await page.locator('#categories').getByRole('button', { name: 'Create category', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create category' })
  const iconButton = dialog.getByRole('button', { name: 'Select New category icon' })
  await iconButton.click()

  const panel = page.getByRole('dialog', { name: 'Select New category icon' })
  await expect(panel.getByRole('searchbox')).toBeVisible({ timeout: 15000 })
  await panel.getByRole('searchbox').fill('dog')
  await panel.getByRole('button', { name: '🐶', exact: true }).click()
  await expect(iconButton).toHaveText('🐶')

  expect(violations).toEqual([])
})

test('draws an institution logo from any https address and from the favicon service with no policy violation', async ({
  page,
  request,
}) => {
  const violations = recordPolicyViolations(page.context())
  const user = await signUpUser(request)
  const square = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#0a6"/></svg>'
  const banks = [
    { name: `Uploaded Bank ${RUN_TAG}`, website: 'https://uploaded-bank.example', logo_url: 'https://logos.example/uploaded.svg' },
    { name: `Favicon Bank ${RUN_TAG}`, website: 'https://favicon-bank.example' },
  ]
  for (const { name, ...details } of banks) {
    const institutionId = await createInstitution(request, user, name, details)
    await createAccount(request, user, { name: `${name} account`, institutionId })
  }

  await page.route('https://logos.example/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: square }))
  await page.route('https://t2.gstatic.com/faviconV2**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: square }))
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  for (const bank of banks) {
    const logo = getAccountRow(page, `${bank.name} account`).getByRole('img', { name: `${bank.name} logo` })
    await expect(logo).toHaveJSProperty('naturalWidth', 32)
  }

  expect(violations).toEqual([])
})
