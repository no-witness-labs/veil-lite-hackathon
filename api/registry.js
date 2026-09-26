const { proxyRegistryRequest } = require('./_registry')

// Vercel rewrites /api/registry/<path> here as ?path=<path> (a nested
// catch-all function loses to the SPA fallback); Vite calls it with the
// original pathname.
module.exports = async function handler(req, res) {
  const url = new URL(req.url || '', 'https://veil.local')
  let path = url.searchParams.get('path')
  if (path === null && url.pathname.startsWith('/api/registry/')) path = url.pathname.slice('/api/registry/'.length)
  return proxyRegistryRequest(req, res, `/${path ?? ''}`)
}
