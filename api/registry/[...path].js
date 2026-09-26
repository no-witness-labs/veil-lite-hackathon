const { proxyRegistryRequest } = require('../_registry')

module.exports = async function handler(req, res) {
  const url = new URL(req.url || '', 'https://veil.local')
  const path = url.pathname.replace(/^\/api/, '')
  return proxyRegistryRequest(req, res, path)
}
