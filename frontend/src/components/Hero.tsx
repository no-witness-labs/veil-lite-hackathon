import type { Role } from '../types'
import type { TourStep } from '../tour'
import { MISSION, ROLE_LABELS } from '../state'

/** The brief band.
 *
 * Rendered at the same compact height on every view and in every lifecycle
 * stage, so it never moves as the workflow advances and the position stays
 * above the fold at a 900px-tall recording viewport.
 *
 * Left: what Veil is. Right: who the visitor is acting as, what that party is
 * here to do, and the guide's next step. It deliberately carries no call to
 * action: the form below has its own submit, and the guide its own button. */
export function Hero({ role, next }: { role: Role; next?: TourStep }) {
  return (
    <div className="v-brief">
      <div className="v-brief__inner">
        <div className="v-brief__product">
          <h1>Private credit. Need-to-know disclosure.</h1>
          <p>
            A lender offers a loan, a borrower locks collateral against it and a valuer prices that collateral.
            Only the parties to a loan can see it.
          </p>
        </div>
        <div className="v-brief__role">
          <div className="v-brief__who">You are the {ROLE_LABELS[role]}</div>
          <p className="v-brief__mission">{MISSION[role]}</p>
          {next && (
            <div className="v-brief__next">
              <span>Next:</span>
              <strong>{next.title}</strong>
              {next.role !== role && <span>(as {ROLE_LABELS[next.role]})</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
