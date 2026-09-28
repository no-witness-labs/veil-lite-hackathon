// Write-ahead command journal and audit log for the Veil lender keeper.
//
// One entry per operation key (`<action kind>:<loan contract id>`), stored in
// <stateDir>/journal.json and replaced atomically (temp file + fsync + rename).
// Every mutation runs under <stateDir>/journal.lock and re-reads the file, so
// the keeper loop and operator commands (--approve/--reject/--retry) can run
// side by side. Every proposal, decision, submission and outcome is also
// appended to <stateDir>/audit.log (JSON lines, never rewritten).
//
// Entry status:
//   proposed   liquidation waiting for maker-checker approvals
//   pending    written before the command is sent; the outcome is not known yet
//   completed  the ledger accepted the command (updateId recorded)
//   rejected   the ledger answered no; rejection.class is transient|definitive
//   unknown    the command may or may not have landed; never resubmitted automatically
//   declined   an approver rejected the proposal
//   stale      proposal voided: its loan contract is no longer active
//   retry      an operator asked for one more attempt (--retry)
import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'

export const MAX_AUTO_ATTEMPTS = 5
const BACKOFF_BASE_MS = 30_000
const BACKOFF_MAX_MS = 15 * 60_000
const LOCK_WAIT_MS = 5_000
// Mutations are local file writes that take milliseconds; a lock this old
// belongs to a process that died inside one.
const LOCK_STALE_MS = 30_000

export const operationKey = (kind, loanCid) => `${kind}:${loanCid}`
export const entryId = (opKey) => createHash('sha256').update(opKey).digest('hex').slice(0, 12)
export const backoffMs = (attempts) => Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS)

/** A journal entry forbids starting this operation now. */
export class BlockedError extends Error {}
/** An operator command that the journal refuses (unknown id, self-approval, ...). */
export class JournalError extends Error {}

/** Whether a new submission of this operation may start at nowMs. */
export function startable(entry, nowMs) {
  if (!entry) return { ok: true }
  switch (entry.status) {
    case 'retry':
      return { ok: true }
    case 'rejected': {
      const r = entry.rejection ?? {}
      if (r.class !== 'transient' || r.dispatched !== false) return { ok: false, reason: `definitive rejection (${r.code}); needs --retry ${entry.opKey}` }
      if (entry.attempts >= MAX_AUTO_ATTEMPTS) return { ok: false, reason: `transient rejection after ${entry.attempts} attempts; needs --retry ${entry.opKey}` }
      if (nowMs < Date.parse(entry.nextAttemptAt)) return { ok: false, reason: `transient rejection (${r.code}); next attempt at ${entry.nextAttemptAt}` }
      return { ok: true }
    }
    case 'pending': return { ok: false, reason: 'a submission is in flight' }
    case 'unknown': return { ok: false, reason: 'outcome unknown; not resubmitted until reconciled or --retry' }
    case 'completed': return { ok: false, reason: `already completed (${entry.updateId})` }
    case 'proposed': return { ok: false, reason: 'awaiting approval' }
    case 'declined': return { ok: false, reason: `proposal declined; needs --retry ${entry.opKey}` }
    case 'stale': return { ok: false, reason: 'proposal voided: loan no longer active' }
    default: return { ok: false, reason: `unrecognised journal status ${entry.status}` }
  }
}

const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase()

export function openJournal(dir, { now = () => Date.now() } = {}) {
  const file = join(dir, 'journal.json')
  const auditFile = join(dir, 'audit.log')
  const lockFile = join(dir, 'journal.lock')
  const iso = () => new Date(now()).toISOString()

  function read() {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, entries: {} }
      throw error
    }
    const state = JSON.parse(text)
    if (state?.version !== 1 || typeof state.entries !== 'object') throw new Error(`${file}: unsupported journal format`)
    return state
  }

  function durableWrite(path, text, flags) {
    const fd = openSync(path, flags, 0o600)
    try {
      writeSync(fd, text)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }

  function write(state) {
    const tmp = `${file}.${process.pid}.tmp`
    durableWrite(tmp, `${JSON.stringify(state, null, 2)}\n`, 'w')
    renameSync(tmp, file)
    const dirFd = openSync(dir, 'r')
    try {
      fsyncSync(dirFd)
    } finally {
      closeSync(dirFd)
    }
  }

  function lock() {
    const deadline = Date.now() + LOCK_WAIT_MS
    for (;;) {
      try {
        closeSync(openSync(lockFile, 'wx', 0o600))
        return () => unlinkSync(lockFile)
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
      let age = 0
      try {
        age = Date.now() - statSync(lockFile).mtimeMs
      } catch {
        continue // released between our open and stat
      }
      if (age > LOCK_STALE_MS) {
        try {
          unlinkSync(lockFile)
        } catch {}
        continue
      }
      if (Date.now() > deadline) throw new Error(`journal is locked (${lockFile}); another keeper command is stuck?`)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    }
  }

  /** Run fn(entries, audit) on a fresh read under the lock; persist, then append audit records. */
  function transact(fn) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const release = lock()
    try {
      const state = read()
      const before = JSON.stringify(state)
      const records = []
      const result = fn(state.entries, (record) => records.push({ at: iso(), ...record }))
      if (JSON.stringify(state) !== before) write(state)
      if (records.length > 0) durableWrite(auditFile, records.map((r) => `${JSON.stringify(r)}\n`).join(''), 'a')
      return result
    } finally {
      release()
    }
  }

  const find = (entries, idOrKey) => entries[idOrKey] ?? Object.values(entries).find((e) => e.id === idOrKey)

  return {
    dir,
    file,
    auditFile,
    list: () => Object.values(read().entries),
    get: (opKey) => read().entries[opKey],

    /**
     * Write-ahead record of a submission, before anything is sent. Throws
     * BlockedError if the operation may not start; `approved` lets a proposal
     * with its quorum through.
     */
    claim({ opKey, kind, loanCid, template, commandId, submissionId, offset, actAs, expect, approved = false }) {
      return transact((entries, audit) => {
        const prev = entries[opKey]
        if (approved) {
          const p = prev?.proposal
          if (prev?.status !== 'proposed' || p.decisions.filter((d) => d.decision === 'approve').length < p.required) {
            throw new BlockedError(`proposal for ${opKey} is ${prev?.status ?? 'missing'} or lacks its approvals`)
          }
        } else {
          const gate = startable(prev, now())
          if (!gate.ok) throw new BlockedError(gate.reason)
        }
        const attempts = prev && prev.status !== 'retry' && prev.status !== 'proposed' ? (prev.attempts ?? 0) + 1 : 1
        const entry = {
          id: entryId(opKey), opKey, kind, loanCid, template,
          status: 'pending', commandId, submissionId, offset, actAs, expect, attempts,
          submittedAt: iso(),
          ...(prev?.proposal ? { proposal: prev.proposal } : {}),
        }
        entries[opKey] = entry
        audit({ event: 'submission', id: entry.id, opKey, commandId, submissionId, offset, actAs, attempts, expect })
        return entry
      })
    },

    /** Record an outcome for the submission that claimed the entry. Returns false if superseded. */
    record(opKey, submissionId, outcome) {
      return transact((entries, audit) => {
        const entry = entries[opKey]
        if (!entry || entry.submissionId !== submissionId || !['pending', 'unknown'].includes(entry.status)) return false
        delete entry.unknownReason
        delete entry.rejection
        delete entry.nextAttemptAt
        Object.assign(entry, outcome, { decidedAt: iso() })
        if (outcome.status === 'rejected' && outcome.rejection.class === 'transient' && outcome.rejection.dispatched === false) {
          entry.nextAttemptAt = new Date(now() + backoffMs(entry.attempts)).toISOString()
        }
        audit({ event: 'outcome', id: entry.id, opKey, commandId: entry.commandId, submissionId, ...outcome, ...(entry.nextAttemptAt ? { nextAttemptAt: entry.nextAttemptAt } : {}) })
        return true
      })
    },

    /** Reconciliation found nothing (yet): keep it unknown, note how far the scan got. */
    markUnknown(opKey, submissionId, reason) {
      return transact((entries, audit) => {
        const entry = entries[opKey]
        if (!entry || entry.submissionId !== submissionId || !['pending', 'unknown'].includes(entry.status)) return false
        const changedStatus = entry.status !== 'unknown'
        entry.status = 'unknown'
        entry.unknownReason = reason
        entry.lastReconcileAt = iso()
        if (changedStatus) audit({ event: 'outcome', id: entry.id, opKey, commandId: entry.commandId, submissionId, status: 'unknown', unknownReason: reason })
        return true
      })
    },

    /** Maker-checker: store a liquidation proposal instead of submitting. Idempotent per operation. */
    propose({ opKey, action, proposer, required }) {
      return transact((entries, audit) => {
        const prev = entries[opKey]
        if (prev && prev.status !== 'retry') return { entry: prev, created: false }
        const entry = {
          id: entryId(opKey), opKey, kind: action.kind, loanCid: action.loanCid, template: action.template,
          status: 'proposed', attempts: 0,
          proposal: { proposer, required, proposedAt: iso(), action, decisions: [] },
        }
        entries[opKey] = entry
        audit({ event: 'proposal', id: entry.id, opKey, proposer, required, action })
        return { entry, created: true }
      })
    },

    /** One approve/reject per approver; the proposer may not decide; a reject needs remarks. */
    decide(idOrKey, { decision, by, remarks = '' }) {
      return transact((entries, audit) => {
        const entry = find(entries, idOrKey)
        if (!entry?.proposal) throw new JournalError(`no proposal ${idOrKey}`)
        if (entry.status !== 'proposed') throw new JournalError(`proposal ${entry.id} is ${entry.status}, not open for decisions`)
        const p = entry.proposal
        if (!String(by ?? '').trim()) throw new JournalError('--by is required')
        if (sameName(by, p.proposer)) throw new JournalError(`${by} proposed ${entry.id} and cannot decide on it`)
        if (p.decisions.some((d) => sameName(d.by, by))) throw new JournalError(`${by} already decided on ${entry.id}`)
        if (decision === 'reject' && !String(remarks).trim()) throw new JournalError('a rejection needs --remarks')
        p.decisions.push({ by: by.trim(), decision, remarks: String(remarks).trim(), at: iso() })
        if (decision === 'reject') entry.status = 'declined'
        const approvals = p.decisions.filter((d) => d.decision === 'approve').length
        audit({ event: 'decision', id: entry.id, opKey: entry.opKey, decision, by: by.trim(), remarks: String(remarks).trim(), approvals, required: p.required })
        return { entry, approvals }
      })
    },

    /** Operator override: allow one more attempt of a rejected, unknown or declined operation. */
    retry(idOrKey, { by }) {
      return transact((entries, audit) => {
        const entry = find(entries, idOrKey)
        if (!entry) throw new JournalError(`no journal entry ${idOrKey}`)
        if (!['rejected', 'unknown', 'declined'].includes(entry.status)) throw new JournalError(`${entry.opKey} is ${entry.status}; only rejected, unknown or declined operations can be retried`)
        const from = entry.status
        entry.status = 'retry'
        entry.attempts = 0
        audit({ event: 'retry', id: entry.id, opKey: entry.opKey, from, by })
        return entry
      })
    },

    /** Void open proposals whose loan contract is no longer active. */
    voidProposals(liveLoanCids) {
      return transact((entries, audit) => {
        const voided = []
        for (const entry of Object.values(entries)) {
          if (entry.status !== 'proposed' || liveLoanCids.has(entry.loanCid)) continue
          entry.status = 'stale'
          voided.push(entry)
          audit({ event: 'outcome', id: entry.id, opKey: entry.opKey, status: 'stale', reason: 'loan contract no longer active' })
        }
        return voided
      })
    },
  }
}
