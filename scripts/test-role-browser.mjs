// Run against Vite + an authenticated sandbox. Requires Playwright with Chromium
// installed, or VEIL_PLAYWRIGHT_MODULE / VEIL_CHROME_PATH for a local installation.
// Resets the demo ledger. Never logs credentials or captures the token input.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createSign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const { chromium } = await import(process.env.VEIL_PLAYWRIGHT_MODULE || 'playwright')
const root = new URL('../', import.meta.url)
execFileSync(process.execPath, [fileURLToPath(new URL('scripts/local-auth.mjs', root)), 'issue'], { stdio: 'pipe' })
const tokens = JSON.parse(await readFile(new URL('.local/auth/tokens.json', root), 'utf8'))
const key = await readFile(new URL('.local/auth/private.pem', root), 'utf8')
const output = new URL('.local/auth/browser-check/', root)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.VEIL_CHROME_PATH ? { executablePath: process.env.VEIL_CHROME_PATH } : {}),
})
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(15_000)
const errors = []
const checks = []
page.on('pageerror', (error) => errors.push(error.message))
let ledgerRequests = 0
page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/v2/')) ledgerRequests++ })

async function check(name, fn) {
  await fn()
  checks.push(name)
  console.log(`PASS ${name}`)
}

async function idle() {
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Refresh' && !b.disabled))
}

async function login(role, token = tokens[role]) {
  await page.getByLabel('Role token').fill(token)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor()
}

async function logout() {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByLabel('Role token').waitFor()
}

async function reset() {
  await idle()
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click()
  await page.getByRole('button', { name: 'Create offer', exact: true }).waitFor()
  await idle()
}

function expiringToken() {
  const [header, encoded] = tokens.lender.split('.')
  const claims = JSON.parse(Buffer.from(encoded, 'base64url'))
  const body = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + 4 })).toString('base64url')
  const input = `${header}.${body}`
  return `${input}.${createSign('RSA-SHA256').update(input).sign(key).toString('base64url')}`
}

try {
  await page.goto(process.env.VEIL_TEST_WEB_URL || 'http://127.0.0.1:5173')
  await page.getByLabel('Role token').waitFor()
  await check('no ledger requests before sign-in', async () => assert.equal(ledgerRequests, 0))
  await page.screenshot({ path: new URL('signin.png', output).pathname, fullPage: true })
  await check('invalid credential is rejected and cleared', async () => {
    await page.getByLabel('Role token').fill('invalid.jwt.token')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert.equal(await page.getByLabel('Role token').inputValue(), '')
    assert.equal(ledgerRequests, 0)
  })
  await login('operator')
  await check('operator has role tabs and can reset/reseed', async () => {
    assert.equal(await page.getByRole('button', { name: 'Borrower', exact: true }).count(), 1)
    await reset()
  })
  await logout()
  for (const role of ['lender', 'borrower', 'valuer', 'regulator', 'outsider']) {
    await login(role)
    await idle()
    await check(`${role} has a fixed role, no reset, and no stored credential`, async () => {
      assert.equal(await page.getByRole('button', { name: 'Reset demo', exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Borrower', exact: true }).count(), 0)
      assert.deepEqual(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })), { local: {}, session: {} })
    })
    if (role === 'lender') await page.screenshot({ path: new URL('lender.png', output).pathname, fullPage: true })
    await logout()
  }
  await check('separate lender and borrower logins complete the UI lending flow', async () => {
    await login('lender')
    await idle()
    await page.getByRole('button', { name: 'Create offer', exact: true }).click()
    await page.getByRole('button', { name: 'Withdraw offer', exact: true }).waitFor()
    await idle()
    await logout()
    await login('borrower')
    await page.getByRole('button', { name: 'Accept offer', exact: true }).click()
    await page.getByRole('button', { name: /^Repay / }).waitFor()
    await idle()
    await page.getByRole('button', { name: /^Repay / }).click()
    await page.getByText('Repaid', { exact: true }).first().waitFor()
    await idle()
    await logout()
  })
  await check('expiration clears the ledger view', async () => {
    await login('lender', expiringToken())
    await page.getByLabel('Role token').waitFor({ timeout: 8000 })
    assert.equal(await page.getByText('Raw ledger view', { exact: true }).count(), 0)
  })
  await check('reload requires sign-in again', async () => {
    await login('lender')
    await page.reload()
    await page.getByLabel('Role token').waitFor()
  })
  await check('delayed prior-session data cannot replace outsider view', async () => {
    let release
    const held = new Promise((resolve) => { release = resolve })
    let intercepted
    const ready = new Promise((resolve) => { intercepted = resolve })
    let first = true
    await page.route('**/v2/state/active-contracts', async (route) => {
      if (!first) { await route.continue(); return }
      first = false
      const response = await route.fetch()
      intercepted()
      await held
      // Signing out aborts this browser request; fulfilling it may be rejected.
      await route.fulfill({ response }).catch(() => {})
    })
    await login('lender')
    await ready
    await logout()
    await login('outsider')
    release()
    await idle()
    await page.getByRole('button', { name: /Raw ledger view/ }).click()
    assert.deepEqual(JSON.parse(await page.locator('pre').innerText()), [])
    await page.unroute('**/v2/state/active-contracts')
    await logout()
  })
  await login('operator')
  await reset()
  await logout()
  assert.deepEqual(errors, [])
  await writeFile(new URL('result.json', output), JSON.stringify({ checks, errors }, null, 2))
  console.log(`${checks.length} browser checks passed; demo reset to canonical holdings.`)
} finally {
  await browser.close()
}
