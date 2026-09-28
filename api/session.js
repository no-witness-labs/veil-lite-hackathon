const { requireAuth } = require('./_auth')
const { beginRequest, sendError, sendJson } = require('./_http')

module.exports = async function handler(req, res) {
  beginRequest(req, res, '/api/session')
  const requestUrl = new URL(req.url || '/', 'https://veil.local')
  if (requestUrl.search) {
    sendError(res, 400, 'REQUEST_INVALID')
    return
  }

  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET')
    sendError(res, 405, 'METHOD_NOT_ALLOWED')
    return
  }

  const auth = requireAuth(req, res)
  if (!auth) return

  sendJson(res, 200, { role: auth.role, userId: auth.userId, expiresAt: auth.expiresAt })
}
