const DEFAULT_LEDGER_TARGET = 'https://ledger-api.validator.devnet.sandbox.fivenorth.io'
const DEFAULT_TOKEN_URL = 'https://auth.sandbox.fivenorth.io/application/o/token/'
const DEFAULT_CLIENT_ID = 'validator-devnet-m2m'

let cachedToken = null

function stripTrailingSlash(value) {
  return value.replace(/\/$/, '')
}

function env(name, fallback = '') {
  return process.env[name] || fallback
}

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable ${name}`)
  return value
}

async function getAccessToken() {
  if (process.env.VEIL_DEVNET_ACCESS_TOKEN) return process.env.VEIL_DEVNET_ACCESS_TOKEN
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) return cachedToken.value

  const tokenUrl = env('VEIL_OIDC_TOKEN_URL', DEFAULT_TOKEN_URL)
  const clientId = env('VEIL_OIDC_CLIENT_ID', DEFAULT_CLIENT_ID)
  const clientSecret = required('VEIL_OIDC_CLIENT_SECRET')
  const audience = env('VEIL_OIDC_AUDIENCE', clientId)
  const scope = env('VEIL_OIDC_SCOPE', 'daml_ledger_api')

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    audience,
    scope,
  })
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`OIDC token exchange failed (HTTP ${res.status}): ${text}`)

  const json = JSON.parse(text)
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000,
  }
  return cachedToken.value
}

function ledgerTarget() {
  return stripTrailingSlash(env('VEIL_LEDGER_TARGET', DEFAULT_LEDGER_TARGET))
}

function ledgerConfig() {
  return {
    jsonApiUrl: '',
    packageRef: env('VEIL_PACKAGE_REF', '#veil-lite'),
    userId: env('VEIL_LEDGER_USER_ID', '6'),
    parties: {
      lender: required('VEIL_PARTY_LENDER'),
      borrower: required('VEIL_PARTY_BORROWER'),
      regulator: required('VEIL_PARTY_REGULATOR'),
      outsider: required('VEIL_PARTY_OUTSIDER'),
    },
  }
}

module.exports = {
  getAccessToken,
  ledgerConfig,
  ledgerTarget,
}
