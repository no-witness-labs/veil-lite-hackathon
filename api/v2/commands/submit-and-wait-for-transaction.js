const { proxyLedgerRequest } = require('../../_ledger')

module.exports = async function handler(req, res) {
  return proxyLedgerRequest(req, res, '/v2/commands/submit-and-wait-for-transaction')
}
