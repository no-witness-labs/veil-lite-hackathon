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
 * Deliberately carries no call to action: the originate form sits directly
 * below it with its own submit, and two buttons firing the same command is a
 * worse experience than one. */
export function Hero() {
  return (
    <div className="v-hero">
      <div className="v-hero__inner">
        <h1>
          Private credit. <em>Need-to-know disclosure.</em>
        </h1>
        <div className="v-hero__row">
          <p>
            Repo-style financing against tokenised collateral. Terms, counterparties and positions exist only on
            the stakeholders’ sub-ledgers — there is no public state for anyone else to scan.
          </p>
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
