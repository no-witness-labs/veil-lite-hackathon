const { getAccessToken, ledgerTarget } = require('../_ledger')

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  try {
    const upstream = await fetch(`${ledgerTarget()}${upstreamPath(req)}`, {
      method: req.method,
      headers: await upstreamHeaders(req),
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await requestBody(req),
    })
    const body = Buffer.from(await upstream.arrayBuffer())
    res.statusCode = upstream.status
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(body)
  } catch (error) {
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ code: 'PROXY_ERROR', cause: String(error) }))
  }
}

function upstreamPath(req) {
  const url = new URL(req.url || '', 'https://veil.local')
  let pathname = url.pathname
  if (pathname.startsWith('/api/v2')) pathname = pathname.replace('/api/v2', '/v2')
  if (!pathname.startsWith('/v2')) {
    const path = req.query?.path
    const parts = Array.isArray(path) ? path : [path].filter(Boolean)
    pathname = `/v2/${parts.join('/')}`
  }
  return `${pathname}${url.search}`
}

async function upstreamHeaders(req) {
  const headers = {}
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type']
  if (req.headers.accept) headers.Accept = req.headers.accept
  headers.Authorization = `Bearer ${await getAccessToken()}`
  return headers
}

function requestBody(req) {
  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body) || typeof req.body === 'string') return req.body
    return JSON.stringify(req.body)
  }

  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
