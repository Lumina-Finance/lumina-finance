import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

const targetUrl = new URL('../support/target.ts', import.meta.url)
const frontend = 'http://frontend.example:5173'
const apiBase = 'http://api.example:8000/api'

// Native TypeScript execution keeps these contracts independent of browser installation
// while resolving the extensionless imports used by Playwright's TypeScript loader
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './target' && context.parentURL?.endsWith('/support/api.ts')) {
      return nextResolve(new URL('./target.ts', context.parentURL).href, context)
    }
    return nextResolve(specifier, context)
  },
})

/** Load the real target in a fresh process so each environment is independent. */
function readTarget(environment) {
  const env = { ...process.env }
  delete env.E2E_BASE_URL
  delete env.E2E_API_BASE_URL
  return spawnSync(process.execPath, [
    '--experimental-strip-types', '--input-type=module', '-e',
    `const target = await import(${JSON.stringify(targetUrl.href)}); console.log(JSON.stringify({ frontend: target.BASE_URL, api: target.API_BASE_URL }))`,
  ], { env: { ...env, ...environment }, encoding: 'utf8' })
}

test('same-origin target defaults the API to /api and normalizes trailing slashes', () => {
  const result = readTarget({ E2E_BASE_URL: `${frontend}///` })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { frontend, api: `${frontend}/api` })
})

test('split target preserves the full API prefix and browser origin', () => {
  const result = readTarget({ E2E_BASE_URL: frontend, E2E_API_BASE_URL: `${apiBase}///` })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { frontend, api: apiBase })
})

test('missing frontend and invalid supplied targets fail before a run', () => {
  for (const environment of [
    {},
    { E2E_BASE_URL: '' },
    { E2E_BASE_URL: '/relative' },
    { E2E_BASE_URL: frontend, E2E_API_BASE_URL: '' },
    { E2E_BASE_URL: frontend, E2E_API_BASE_URL: '/api' },
    { E2E_BASE_URL: frontend, E2E_API_BASE_URL: 'ftp://api.example/api' },
    { E2E_BASE_URL: `${frontend}?query=yes` },
    { E2E_BASE_URL: frontend, E2E_API_BASE_URL: `${apiBase}#fragment` },
  ]) {
    const result = readTarget(environment)
    assert.notEqual(result.status, 0, JSON.stringify(environment))
    assert.match(result.stderr, /E2E_(API_)?BASE_URL/)
  }
})

process.env.E2E_BASE_URL = frontend
process.env.E2E_API_BASE_URL = apiBase
const target = await import(targetUrl.href)
const support = await import('../support/api.ts')

test('readiness checks both frontend and the configured API health endpoint', async (context) => {
  const urls = []
  context.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url)
    return new Response(url === frontend ? '<html></html>' : '{"status":"ok"}')
  })
  await target.requireAppReachable()
  assert.deepEqual(urls.sort(), [frontend, `${apiBase}/health`].sort())
})

for (const failedTarget of ['frontend', 'API']) {
  test(`readiness reports an unavailable ${failedTarget} even when the other target serves`, async (context) => {
    let now = 0
    context.mock.method(Date, 'now', () => now)
    context.mock.method(globalThis, 'setTimeout', (settle) => {
      now = 60_001
      queueMicrotask(settle)
    })
    context.mock.method(globalThis, 'fetch', async (url) => {
      const failed = failedTarget === 'frontend' ? url === frontend : url === `${apiBase}/health`
      return new Response(failed ? 'unavailable' : url === frontend ? '<html></html>' : '{"status":"ok"}', {
        status: failed ? 503 : 200,
      })
    })
    await assert.rejects(target.requireAppReachable(), new RegExp(`${failedTarget}.*503`))
  })
}

test('readiness refuses API success responses without healthy JSON', async (context) => {
  let now = 0
  context.mock.method(Date, 'now', () => now)
  context.mock.method(globalThis, 'setTimeout', (settle) => {
    now = 60_001
    queueMicrotask(settle)
  })
  context.mock.method(globalThis, 'fetch', async (url) => new Response(
    url === frontend ? '<html></html>' : '{"status":"starting"}',
  ))
  await assert.rejects(target.requireAppReachable(), /API not healthy.*health answered "starting"/)
})

test('every API seeding helper overrides the request context frontend base URL', async () => {
  const calls = []

  /** Emulate request URL resolution and server responses without creating application data. */
  async function send(method, url, options) {
    const resolved = new URL(url, frontend)
    calls.push({ method, url: resolved.href, options })
    const path = resolved.pathname
    const body = path.endsWith('/auth/signup') ? { access_token: 'contract-token' }
      : path.endsWith('/categories') ? [{ id: 'category-id', name: 'Groceries' }]
      : path.endsWith('/merchants') ? [{ id: 'merchant-id', name: 'Unknown' }]
      : { id: `${path.split('/').at(-1)}-id` }
    return {
      status: () => method === 'POST' ? 201 : 200,
      ok: () => true,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
  }

  const request = {
    get: (url, options) => send('GET', url, options),
    post: (url, options) => send('POST', url, options),
  }
  const user = await support.signUpUser(request)
  const account = await support.createAccount(request, user, { name: 'Contract account' })
  await support.createTransaction(request, user, {
    accountId: account.id, categoryName: 'Groceries', amount: -4250, date: '2026-09-01',
  })
  await support.createMonthlyBudget(request, user, {
    name: 'Contract budget', categoryNames: ['Groceries'], overallLimit: 10000, periodStart: '2026-09-01',
  })

  assert.deepEqual(calls.map(({ method, url }) => [method, url]), [
    ['POST', `${apiBase}/auth/signup`],
    ['POST', `${apiBase}/accounts`],
    ['GET', `${apiBase}/categories`],
    ['GET', `${apiBase}/merchants`],
    ['POST', `${apiBase}/transactions`],
    ['GET', `${apiBase}/categories`],
    ['POST', `${apiBase}/base-budgets`],
  ])
  for (const { options } of calls.slice(1)) {
    assert.equal(options.headers.Authorization, 'Bearer contract-token')
  }
})
