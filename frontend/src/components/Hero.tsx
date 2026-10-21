import type { Role } from '../types'
import type { TourStep } from '../tour'
import { MISSION, ROLE_LABELS } from '../state'
import { Label } from '../ui/primitives'

/** The three properties the demo exists to prove. Stated once, in the frame,
 * rather than repeated across the workspace. */
const CLAIMS = ['Need-to-know privacy', 'Structural authorisation', 'Selective disclosure']

/** The statement band.
 *
 * Rendered at the same compact height on every view and in every lifecycle
 * stage — it is the frame the product is read through, so it must not move or
 * shrink as the workflow advances, and it must leave the position visible above
 * the fold at a 900px-tall recording viewport.
 *
 * It tells a first-time visitor what the app is, who they are acting as and
 * what that party is here to do, plus the guide's next step. It deliberately
 * carries no call to action: the originate form sits directly below it with its
 * own submit, and two buttons firing the same command is a worse experience
 * than one. */
export function Hero({ role, next }: { role: Role; next?: TourStep }) {
  return (
    <div className="v-hero">
      <div className="v-hero__inner">
        <h1>
          Private credit. <em>Need-to-know disclosure.</em>
        </h1>
        <div className="v-hero__row">
          <div className="v-hero__brief">
            <p>
              A lender offers a loan, a borrower locks collateral against it and a valuer prices that collateral.
              Only the parties to a loan can see it.
            </p>
            <p className="v-hero__mission">
              <Label>You are the {ROLE_LABELS[role]}</Label> {MISSION[role]}
            </p>
            {next && (
              <p className="v-hero__next">
                <Label>Next</Label> {next.title}
                {next.role !== role && ` · as ${ROLE_LABELS[next.role]}`}
              </p>
            )}
          </div>
          <ul className="v-claims">
            {CLAIMS.map((c) => (
              <li key={c}>
                <Label>{c}</Label>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
