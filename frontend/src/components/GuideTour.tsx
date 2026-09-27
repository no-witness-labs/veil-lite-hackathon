import type { Role } from '../types'
import type { StepId, TourStep, TourTrack } from '../tour'
import { ROLE_LABELS, ROLE_TONE } from '../state'
import { Button, Label, Panel, Tag } from '../ui/primitives'

/** Step-by-step guide for a first visit. It only tells the visitor what to do
 * next; every action is still taken by the visitor as that party. */
export function GuideTour({
  role,
  steps,
  done,
  track,
  coinAvailable,
  hints,
  collapsed,
  busy,
  onTrack,
  onSwitch,
  onRestart,
  onToggle,
}: {
  role: Role
  steps: TourStep[]
  done: Set<StepId>
  track: TourTrack
  coinAvailable: boolean
  hints: string[]
  collapsed: boolean
  busy: boolean
  onTrack: (track: TourTrack) => void
  /** Null when this session cannot switch parties by itself. */
  onSwitch: ((role: Role) => void) | null
  onRestart: () => void
  onToggle: () => void
}) {
  const current = steps.find((step) => !done.has(step.id))
  const position = current ? steps.indexOf(current) + 1 : steps.length
  const finished = !current

  if (collapsed) {
    return (
      <Panel
        title="Guided demo"
        kicker={finished ? 'complete' : `step ${position} of ${steps.length}`}
        actions={<Button size="sm" onClick={onToggle}>Show</Button>}
      >
        <span />
      </Panel>
    )
  }

  return (
    <Panel
      title="Guided demo"
      kicker={finished ? 'complete' : `step ${position} of ${steps.length}`}
      actions={<Button size="sm" onClick={onToggle}>Hide</Button>}
      flush
    >
      <div style={{ padding: 'var(--space-4) var(--space-5)', display: 'grid', gap: 'var(--space-4)' }}>
        <div className="v-row" role="radiogroup" aria-label="Demo track" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Button size="sm" variant={track === 'tbill' ? 'primary' : 'ghost'} onClick={() => onTrack('tbill')}>
            T-Bill loan
          </Button>
          <Button
            size="sm"
            variant={track === 'coin' ? 'primary' : 'ghost'}
            onClick={() => onTrack('coin')}
            disabled={!coinAvailable}
            title={coinAvailable ? undefined : 'Needs the DevNet token registry'}
          >
            Canton Coin loan
          </Button>
        </div>

        {current ? (
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <div className="v-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Tag tone={ROLE_TONE[current.role]} dot>
                {ROLE_LABELS[current.role]}
              </Tag>
              <strong>{current.title}</strong>
            </div>
            <p style={{ margin: 0, color: 'var(--ink-700)', lineHeight: 'var(--leading-relaxed)' }}>{current.instruction}</p>
            {current.role === role ? (
              <Label>You are the {ROLE_LABELS[role]}: do this now.</Label>
            ) : onSwitch ? (
              <Button variant="primary" onClick={() => onSwitch(current.role)} busy={busy}>
                Continue as {ROLE_LABELS[current.role]}
              </Button>
            ) : (
              <Label>Sign in as the {ROLE_LABELS[current.role]} to continue.</Label>
            )}
          </div>
        ) : (
          <p style={{ margin: 0, color: 'var(--ink-700)', lineHeight: 'var(--leading-relaxed)' }}>
            That is the whole loan, enforced and kept private by Canton. Try the other track, a top-up, collateral
            substitution, or look at the Loan book and Disclosure tabs.
          </p>
        )}

        {hints.map((hint) => (
          <div key={hint} className="v-banner v-banner--warn" role="status">
            <span className="v-tag__dot" style={{ marginTop: 7 }} />
            <div className="v-banner__body">{hint}</div>
          </div>
        ))}

        <ol style={{ margin: 0, paddingLeft: 'var(--space-5)', display: 'grid', gap: 'var(--space-1)' }}>
          {steps.map((step) => (
            <li
              key={step.id}
              style={{
                color: done.has(step.id) ? 'var(--ink-500)' : step === current ? 'var(--ink-900)' : 'var(--ink-500)',
                fontWeight: step === current ? 600 : 400,
                textDecoration: done.has(step.id) ? 'line-through' : undefined,
              }}
            >
              {ROLE_LABELS[step.role]}: {step.title}
            </li>
          ))}
        </ol>

        <div className="v-row" style={{ justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" onClick={onRestart}>
            Restart guide
          </Button>
        </div>
      </div>
    </Panel>
  )
}
