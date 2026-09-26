import type { Holding, Role } from '../types'
import { PARTY_NAMES, UNIT_CASH, fmtAmount, shortId } from '../state'
import { Panel, Tag } from '../ui/primitives'

/** The active party's own wallet. Holdings are issuer + owner signatory with
 * no observers, so each role sees only its own — a second, independent privacy
 * signal alongside the deal contracts. */
export function PositionsTable({ role, holdings }: { role: Role; holdings: Holding[] }) {
  const rows = [...holdings].sort((a, b) =>
    a.kind === b.kind ? b.amount - a.amount : a.kind === 'cash' ? -1 : 1,
  )
  const cash = rows.filter((h) => h.kind === 'cash').reduce((s, h) => s + h.amount, 0)
  const units = rows.filter((h) => h.kind === 'collateral').reduce((s, h) => s + h.amount, 0)
  const coin = rows.filter((h) => h.kind === 'coin').reduce((s, h) => s + h.amount, 0)

  return (
    <Panel
      title="Holdings"
      kicker={`${PARTY_NAMES[role]} · issuer + owner only`}
      flush
      footer={
        <>
          <span className="v-id">
            {fmtAmount(cash)} {UNIT_CASH} · {fmtAmount(units, 0)} units{coin > 0 ? ` · ${fmtAmount(coin)} CC` : ''}
          </span>
          <span className="v-id">{rows.length} contract{rows.length === 1 ? '' : 's'}</span>
        </>
      }
    >
      {rows.length === 0 ? (
        <div style={{ padding: 'var(--space-5)' }} className="v-dim">
          No holdings visible to this party.
        </div>
      ) : (
        <table className="v-table" data-testid="holdings">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Type</th>
              <th>Asset</th>
              <th>Contract</th>
              <th className="v-num">Quantity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.contractId}>
                <td>
                  <Tag tone={h.kind === 'cash' ? 'accent' : 'info'}>{h.kind}</Tag>
                </td>
                <td style={{ color: 'var(--ink-900)' }}>
                  {h.kind === 'cash' ? 'USDC' : (h.asset ?? 'Collateral')}{' '}
                  <span className="v-muted">{h.kind === 'coin' ? '(real, DevNet)' : '(simulated)'}</span>
                </td>
                <td>
                  <span className="v-id" title={h.contractId}>{shortId(h.contractId, 10, 6)}</span>
                </td>
                <td className="v-num">
                  {fmtAmount(h.amount, h.kind === 'collateral' ? 0 : 2)}
                  <span className="v-metric__unit">{h.kind === 'cash' ? UNIT_CASH : h.kind === 'coin' ? 'CC' : 'units'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}
