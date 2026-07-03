const { proxyLedgerRequest } = require('../_ledger')

module.exports = async function handler(req, res) {
  return proxyLedgerRequest(req, res, upstreamPath(req))
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
