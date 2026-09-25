import type { Status } from '../types'
import { STEP_INDEX, lifecycleSteps } from '../state'
import { Label } from '../ui/primitives'

/** Segmented progress matrix. Each stage owns three cells, so the bar reads as
 * a block of colour rather than a row of dots — legible at a glance and at a
 * distance, which is what a demo screen needs. */
const CELLS_PER_STAGE = 3

export function Lifecycle({ status }: { status: Status }) {
  const steps = lifecycleSteps(status)
  const current = STEP_INDEX[status]
  const liquidated = status === 'liquidated'
  const terminal = current === steps.length - 1

  return (
    <div>
      <div className="v-matrix" role="img" aria-label={`Lifecycle stage ${current + 1} of ${steps.length}`}>
        {steps.flatMap((step, stage) =>
          Array.from({ length: CELLS_PER_STAGE }, (_, cell) => {
            let cls = ''
            if (stage < current) cls = 'is-done'
            else if (stage === current) {
              if (terminal) cls = liquidated ? 'is-end-bad' : 'is-end-ok'
              else cls = 'is-now'
            }
            return <i key={`${step.key}-${cell}`} className={cls} />
          }),
        )}
      </div>
      <div className="v-matrix-labels">
        {steps.map((step, i) => (
          <Label key={step.key} className={i === current ? 'is-current' : undefined}>
            {step.label}
          </Label>
        ))}
      </div>
    </div>
  )
}
