import { dirname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const envDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '')
  const target = stripTrailingSlash(env.VEIL_LEDGER_TARGET || env.VITE_LEDGER_TARGET || 'http://127.0.0.1:6864')
  const base = env.VITE_BASE_PATH || '/'

  return {
    base,
    plugins: [ledgerApiProxy(target, env), react()],
    server: { port: 5173 },
  }
})

function ledgerApiProxy(target: string, env: Record<string, string>): Plugin {
  const oidc = {
    accessToken: env.VEIL_DEVNET_ACCESS_TOKEN,
    tokenUrl: env.VEIL_OIDC_TOKEN_URL,
    clientId: env.VEIL_OIDC_CLIENT_ID,
    clientSecret: env.VEIL_OIDC_CLIENT_SECRET,
    audience: env.VEIL_OIDC_AUDIENCE,
    scope: env.VEIL_OIDC_SCOPE || 'daml_ledger_api',
  }
  let cached: { value: string; expiresAt: number } | null = null

  async function getToken(): Promise<string | null> {
    if (oidc.accessToken) return oidc.accessToken
    if (!oidc.tokenUrl || !oidc.clientId || !oidc.clientSecret) return null
    if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.value

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: oidc.clientId,
      client_secret: oidc.clientSecret,
      scope: oidc.scope,
    })
    if (oidc.audience) body.set('audience', oidc.audience)

    const res = await fetch(oidc.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`OIDC token exchange failed (HTTP ${res.status}): ${text}`)
    const json = JSON.parse(text) as { access_token: string; expires_in?: number }
    cached = {
      value: json.access_token,
      expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
    }
    return cached.value
  }

  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith('/v2')) {
      next()
      return
    }

    try {
      const token = await getToken()
      const headers: Record<string, string> = {}
      const contentType = header(req, 'content-type')
      if (contentType) headers['Content-Type'] = contentType
      const accept = header(req, 'accept')
      if (accept) headers.Accept = accept
      if (token) headers.Authorization = `Bearer ${token}`

      const upstream = await fetch(`${target}${req.url}`, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req),
      })
      await sendUpstream(res, upstream)
    } catch (error) {
      res.statusCode = 502
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ code: 'PROXY_ERROR', cause: String(error) }))
    }
  }

  return {
    name: 'veil-ledger-api-proxy',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '')
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function sendUpstream(res: ServerResponse, upstream: Response): Promise<void> {
  res.statusCode = upstream.status
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
  const body = Buffer.from(await upstream.arrayBuffer())
  res.end(body)
}
