const { ledgerConfig } = require('./_ledger')
const { beginRequest, sendError, sendJson } = require('./_http')

module.exports = async function handler(req, res) {
  beginRequest(req, res, '/ledger-config.json')
  const method = String(req.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    sendError(res, 405, 'METHOD_NOT_ALLOWED')
    return
  }

  let config
  try {
    config = ledgerConfig()
  } catch {
    sendError(res, 500, 'CONFIG_ERROR')
    return
  }
  sendJson(res, 200, config)
}
