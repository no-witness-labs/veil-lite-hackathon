import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyFailure,
  describeCompletionError,
  describeFailure,
  newCommandId,
  parseErrorBody,
  resolveOutcome,
} from '../frontend/src/commandOutcome.ts'

const noSleep = async () => {}
const options = (overrides = {}) => ({ attempts: 5, delayMs: 0, sleep: noSleep, retryable: (error) => error instanceof TypeError, ...overrides })

test('a definite ledger rejection is rejected; lost responses and timeouts are unknown', () => {
  const daml = parseErrorBody(JSON.stringify({ code: 'DAML_FAILURE', message: 'valuation is stale', requestId: 'r1', errorId: 'UNHANDLED_EXCEPTION/DA.Exception.AssertionFailed:AssertionFailed', category: 9 }))
  assert.equal(classifyFailure(400, daml), 'rejected')
  assert.equal(classifyFailure(403, parseErrorBody('{"code":"PARTY_FORBIDDEN","message":"m","requestId":"r"}')), 'rejected')
  // Proxy-side failures before the ledger call are definite too.
  assert.equal(classifyFailure(503, parseErrorBody('{"code":"UPSTREAM_UNAVAILABLE","message":"m","requestId":"r"}')), 'rejected')

  assert.equal(classifyFailure(504, parseErrorBody('{"code":"LEDGER_TIMEOUT","message":"m","requestId":"r"}')), 'unknown')
  assert.equal(classifyFailure(502, parseErrorBody('{"code":"PROXY_ERROR","message":"m","requestId":"r"}')), 'unknown')
  assert.equal(classifyFailure(500, { code: 'SOME_TIMEOUT', category: 3 }), 'unknown')
  assert.equal(classifyFailure(503, { code: 'SERVICE_NOT_RUNNING', category: 1 }), 'unknown')
  // A gateway page (e.g. the function timed out) has no envelope.
  assert.equal(classifyFailure(504, parseErrorBody('<html>timeout</html>')), 'unknown')
  assert.equal(classifyFailure(400, parseErrorBody('not json')), 'rejected')
})

test('the Daml message reaches the user, with a code and request id to report', () => {
  const stale = parseErrorBody(JSON.stringify({ code: 'DAML_FAILURE', message: 'valuation is stale', requestId: 'req-1', errorId: 'UNHANDLED_EXCEPTION/DA.Exception.AssertionFailed:AssertionFailed', category: 9 }))
  assert.equal(describeFailure(400, stale), 'valuation is stale (DAML_FAILURE; request req-1)')
  const withdraw = parseErrorBody(JSON.stringify({ code: 'DAML_FAILURE', message: 'Cannot withdraw a committed allocation before its settlement deadline.', requestId: 'req-2', errorId: 'cannot-withdraw-committed-allocation' }))
  assert.equal(describeFailure(400, withdraw), 'Cannot withdraw a committed allocation before its settlement deadline. (cannot-withdraw-committed-allocation; request req-2)')
  assert.equal(describeFailure(502, null), 'The server returned HTTP 502.')
  assert.equal(describeCompletionError({ code: 'DAML_FAILURE', message: 'acceptance LTV must be below the liquidation threshold', errorId: 'UNHANDLED_EXCEPTION/X' }), 'acceptance LTV must be below the liquidation threshold (DAML_FAILURE)')
})

test('command ids are unique per submission', () => {
  let n = 0
  const ids = new Set(Array.from({ length: 3 }, () => newCommandId('repay', () => String(++n))))
  assert.equal(ids.size, 3)
  assert.match(newCommandId('repay', () => 'abc'), /^veil-repay-abc$/)
})

test('an unknown outcome resolves to completed once the command appears in the completion stream', async () => {
  const begins = []
  const pages = [
    { completions: [{ commandId: 'other', offset: 11, succeeded: true, updateId: 'u0' }], lastOffset: 11 },
    { completions: [], lastOffset: 12 },
    { completions: [{ commandId: 'mine', offset: 13, succeeded: true, updateId: 'u1' }], lastOffset: 13 },
  ]
  const result = await resolveOutcome('mine', 10, async (begin) => { begins.push(begin); return pages.shift() }, options())
  assert.deepEqual(result, { outcome: 'completed', updateId: 'u1', offset: 13 })
  // Reads resume after what was already seen, starting from the pre-submit ledger end.
  assert.deepEqual(begins, [10, 11, 12])
})

test('an unknown outcome resolves to rejected with the ledger message', async () => {
  const error = { code: 'DAML_FAILURE', message: 'valuation is stale', category: 9 }
  const result = await resolveOutcome('mine', 10, async () => ({ completions: [{ commandId: 'mine', offset: 12, succeeded: false, error }], lastOffset: 12 }), options())
  assert.deepEqual(result, { outcome: 'rejected', error })
})

test('network failures while checking are retried; other errors propagate; no answer stays unknown', async () => {
  let calls = 0
  const flaky = async () => {
    calls += 1
    if (calls < 3) throw new TypeError('Failed to fetch')
    return { completions: [{ commandId: 'mine', offset: 12, succeeded: true, updateId: 'u' }], lastOffset: 12 }
  }
  assert.equal((await resolveOutcome('mine', 10, flaky, options())).outcome, 'completed')

  await assert.rejects(resolveOutcome('mine', 10, async () => { throw new Error('session changed') }, options()), /session changed/)

  let slept = 0
  const never = await resolveOutcome('mine', 10, async () => ({ completions: [], lastOffset: null }), options({ attempts: 4, sleep: async () => { slept += 1 } }))
  assert.deepEqual(never, { outcome: 'unknown' })
  assert.equal(slept, 3)
})
