#!/usr/bin/env node
/**
 * Create the local RS256 material used by the authenticated Canton sandbox.
 *
 * The private key, role tokens, and curl header files live below .local/auth,
 * which is ignored by git.  This command deliberately never prints a bearer
 * token; callers that need one should use the generated header file.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSign, generateKeyPairSync } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AUTH_DIR = join(ROOT, '.local', 'auth')
const HEADERS_DIR = join(AUTH_DIR, 'headers')
const PRIVATE_KEY_FILE = join(AUTH_DIR, 'private.pem')
const PUBLIC_KEY_FILE = join(AUTH_DIR, 'public.pem')
const CERTIFICATE_FILE = join(AUTH_DIR, 'cert.pem')
const TOKENS_FILE = join(AUTH_DIR, 'tokens.json')

const AUDIENCE = 'veil-local'
const ISSUER = 'veil-local'
// Canton 3.5.1 rejects tokens with more than five minutes remaining by default.
const TTL_SECONDS = positiveInteger(process.env.VEIL_AUTH_TTL_SECONDS, 5 * 60)
if (TTL_SECONDS > 300) throw new Error('VEIL_AUTH_TTL_SECONDS must be at most 300 (Canton token lifetime limit).')

const SUBJECTS = {
  participant_admin: 'participant_admin',
  operator: 'veil-operator',
  lender: 'veil-lender',
  borrower: 'veil-borrower',
  valuer: 'veil-valuer',
  regulator: 'veil-regulator',
  outsider: 'veil-outsider',
}

function positiveInteger(raw, fallback) {
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Expected a positive integer, got ${JSON.stringify(raw)}`)
  }
  return value
}

function writePrivate(file, value) {
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, value, { encoding: 'utf8', mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, file)
}

function writePublic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, value, { encoding: 'utf8', mode: 0o644 })
  chmodSync(temporary, 0o644)
  renameSync(temporary, file)
}

function ensureDirectory() {
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 })
  mkdirSync(HEADERS_DIR, { recursive: true, mode: 0o700 })
  chmodSync(AUTH_DIR, 0o700)
  chmodSync(HEADERS_DIR, 0o700)
}

function generateKeyMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })

  writePrivate(PRIVATE_KEY_FILE, privateKey)
  writePublic(PUBLIC_KEY_FILE, publicKey)
  makeCertificate()
}

function makeCertificate() {
  const result = spawnSync(
    'openssl',
    [
      'req',
      '-new',
      '-x509',
      '-sha256',
      '-days',
      '3650',
      '-key',
      PRIVATE_KEY_FILE,
      '-out',
      CERTIFICATE_FILE,
      '-subj',
      `/CN=${ISSUER}`,
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error(`openssl could not create the local JWT certificate: ${result.stderr || 'unknown error'}`)
  }
  chmodSync(CERTIFICATE_FILE, 0o644)
}

function ensureKeyMaterial({ rotate = false } = {}) {
  ensureDirectory()
  const complete = existsSync(PRIVATE_KEY_FILE) && existsSync(PUBLIC_KEY_FILE)
  if (rotate || !complete) {
    generateKeyMaterial()
    return
  }
  if (!existsSync(CERTIFICATE_FILE)) makeCertificate()
}

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

function signToken(subject, now, privateKey) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: subject,
      iat: now,
      exp: now + TTL_SECONDS,
    }),
  )
  const signingInput = `${header}.${payload}`
  const signature = createSign('RSA-SHA256').update(signingInput).end().sign(privateKey)
  return `${signingInput}.${signature.toString('base64url')}`
}

function issueTokens() {
  ensureDirectory()
  ensureKeyMaterial()
  const privateKey = readFileSync(PRIVATE_KEY_FILE, 'utf8')
  const now = Math.floor(Date.now() / 1000)
  const tokens = Object.fromEntries(
    Object.entries(SUBJECTS).map(([role, subject]) => [role, signToken(subject, now, privateKey)]),
  )

  const tokenTemporary = `${TOKENS_FILE}.${process.pid}.tmp`
  writeFileSync(tokenTemporary, `${JSON.stringify(tokens, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  chmodSync(tokenTemporary, 0o600)
  renameSync(tokenTemporary, TOKENS_FILE)

  for (const [role, token] of Object.entries(tokens)) {
    const headerFile = join(HEADERS_DIR, `${role}.txt`)
    writePrivate(headerFile, `Authorization: Bearer ${token}\n`)
  }
}

function main() {
  const command = process.argv[2] || 'ensure'
  if (command === 'ensure') {
    ensureKeyMaterial()
    issueTokens()
  } else if (command === 'issue') {
    issueTokens()
  } else if (command === 'rotate') {
    ensureKeyMaterial({ rotate: true })
    issueTokens()
  } else {
    throw new Error(`Unknown command ${JSON.stringify(command)}; expected ensure, issue, or rotate`)
  }
  process.stdout.write(`Local auth material is ready in ${AUTH_DIR}\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
