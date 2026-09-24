const { requireAuth } = require('./_auth')

module.exports = async function handler(req, res) {
  const requestUrl = new URL(req.url || '/', 'https://veil.local')
  if (requestUrl.search) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ code: 'REQUEST_INVALID' }))
    return
  }

  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    res.statusCode = 405
    res.setHeader('Allow', 'GET')
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ code: 'METHOD_NOT_ALLOWED' }))
    return
  }

  const auth = requireAuth(req, res)
  if (!auth) return

  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify({ role: auth.role, userId: auth.userId, expiresAt: auth.expiresAt }))
}
