import { dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const envDir = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const ledgerApi = require('../api/_ledger.js') as {
  proxyLedgerRequest: (req: IncomingMessage & { veilEnv?: Record<string, string> }, res: ServerResponse, path: string, options?: Record<string, unknown>) => Promise<void>
}
const sessionHandler = require('../api/session.js') as (req: IncomingMessage & { veilEnv?: Record<string, string> }, res: ServerResponse) => Promise<void> | void
const registryApi = require('../api/_registry.js') as {
  proxyRegistryRequest: (req: IncomingMessage & { veilEnv?: Record<string, string> }, res: ServerResponse, path: string, env?: Record<string, string>) => Promise<void>
}
const demoLoginHandler = require('../api/demo-login.js') as (req: IncomingMessage & { veilEnv?: Record<string, string> }, res: ServerResponse) => Promise<void> | void
const { proxyLedgerRequest } = ledgerApi

export default defineConfig(({ mode }) => {
  const env = withLocalLedgerConfig(loadEnv(mode, envDir, ''))
  const target = stripTrailingSlash(env.VEIL_LEDGER_TARGET || env.VITE_LEDGER_TARGET || 'http://127.0.0.1:6864')
  const base = env.VITE_BASE_PATH || '/'

  return {
    base,
    plugins: [ledgerApiProxy(target, env), react()],
    server: {
      port: 5173,
      // Keep the dev server's file surface inside the frontend. The auth
      // directory is denied explicitly as defense in depth for /@fs requests.
      fs: {
        allow: [envDir],
        deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/.local/**'],
      },
    },
  }
})

function ledgerApiProxy(target: string, env: Record<string, string>): Plugin {
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    const pathname = requestPath(req)
    const authReq = req as IncomingMessage & { veilEnv?: Record<string, string> }
    if (pathname === '/api/session') {
      authReq.veilEnv = env
      await sessionHandler(authReq, res)
      return
    }
    if (pathname.startsWith('/api/registry/')) {
      authReq.veilEnv = env
      await registryApi.proxyRegistryRequest(authReq, res, pathname.replace(/^\/api\/registry/, ''), env)
      return
    }
    if (pathname === '/api/demo-login') {
      authReq.veilEnv = env
      await demoLoginHandler(authReq, res)
      return
    }
    if (!pathname.startsWith('/v2')) {
      next()
      return
    }

    authReq.veilEnv = env
    await proxyLedgerRequest(authReq, res, pathname, { env, target })
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

function requestPath(req: IncomingMessage): string {
  return new URL(req.url || '/', 'http://vite.local').pathname
}

function withLocalLedgerConfig(env: Record<string, string>): Record<string, string> {
  try {
    const loaded = JSON.parse(readFileSync(`${envDir}/public/ledger-config.json`, 'utf8')) as {
      packageRef?: unknown
      issuer?: unknown
      parties?: Record<string, unknown>
    }
    const values: Record<string, string> = {
      VEIL_PACKAGE_REF: stringValue(loaded.packageRef),
      VEIL_PARTY_ISSUER: stringValue(loaded.issuer),
      VEIL_PARTY_LENDER: stringValue(loaded.parties?.lender),
      VEIL_PARTY_BORROWER: stringValue(loaded.parties?.borrower),
      VEIL_PARTY_REGULATOR: stringValue(loaded.parties?.regulator),
      VEIL_PARTY_VALUER: stringValue(loaded.parties?.valuer),
      VEIL_PARTY_OUTSIDER: stringValue(loaded.parties?.outsider),
    }
    for (const [name, value] of Object.entries(values)) {
      if (value && !env[name]) env[name] = value
    }
  } catch {
    // A clean checkout has no generated config; the auth boundary then fails
    // closed until the sandbox bootstrap or hosted environment is configured.
  }
  return env
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
