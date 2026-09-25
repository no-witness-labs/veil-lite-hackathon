/* Typed primitives over the component stylesheet.
 *
 * These exist so feature components never hand-roll a class string or a style
 * object. Every visual decision is either a token (theme/tokens.css) or a class
 * (theme/components.css); this file is the seam between them and React.
 */
import type { CSSProperties, ReactNode } from 'react'

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'sky'

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

/* ------------------------------------------------------------------ Text -- */

/** The uppercase mono caption used to title every field, column and block. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('v-label', className)}>{children}</div>
}

/** Inline monospace run — contract ids, offsets, party identifiers. */
export function Mono({
  children,
  className,
  title,
}: {
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span className={cx('v-mono', className)} title={title}>
      {children}
    </span>
  )
}

/* ----------------------------------------------------------------- Panel -- */

export function Panel({
  title,
  kicker,
  actions,
  footer,
  flush,
  children,
  id,
}: {
  title?: ReactNode
  /** Secondary text beside the title — counts, scope, provenance. */
  kicker?: ReactNode
  /** Right-aligned header slot. */
  actions?: ReactNode
  footer?: ReactNode
  /** Drop body padding when the child manages its own (tables, code wells). */
  flush?: boolean
  children: ReactNode
  id?: string
}) {
  return (
    <section className="v-panel" id={id}>
      {(title || actions) && (
        <header className="v-panel__head">
          <div className="v-panel__title">
            {title && <h2>{title}</h2>}
            {kicker && <Label>{kicker}</Label>}
          </div>
          {actions && <div className="v-row" style={{ gap: 'var(--space-2)' }}>{actions}</div>}
        </header>
      )}
      <div className={cx('v-panel__body', flush && 'v-panel__body--flush')}>{children}</div>
      {footer && <footer className="v-panel__foot">{footer}</footer>}
    </section>
  )
}

/** A hairline-separated block inside a flush panel. */
export function Section({
  label,
  actions,
  children,
}: {
  label?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="v-section">
      {(label || actions) && (
        <div className="v-row v-section__label" style={{ justifyContent: 'space-between', gap: 'var(--space-3)' }}>
          {label && <Label>{label}</Label>}
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------- Tag -- */

export function Tag({
  tone = 'neutral',
  dot,
  children,
}: {
  tone?: Tone
  /** Render a leading status dot. */
  dot?: boolean
  children: ReactNode
}) {
  return (
    <span className={`v-tag v-tag--${tone}`}>
      {dot && <span className="v-tag__dot" />}
      {children}
    </span>
  )
}

/* ---------------------------------------------------------------- Metric -- */

export function Metric({
  label,
  value,
  unit,
  note,
  size = 'md',
  tone,
}: {
  label: ReactNode
  value: ReactNode
  /** Rendered smaller and dimmer after the value, so 105 USDC aligns on the 5. */
  unit?: string
  note?: ReactNode
  size?: 'md' | 'lg' | 'xl'
  tone?: Tone
}) {
  const sizeClass = size === 'md' ? '' : `v-metric__value--${size}`
  const style: CSSProperties | undefined = tone ? { color: `var(--${tone === 'neutral' ? 'ink-900' : tone})` } : undefined
  return (
    <div className="v-metric">
      {label ? <Label>{label}</Label> : null}
      <div className={cx('v-metric__value', sizeClass)} style={style}>
        {value}
        {unit && <span className="v-metric__unit">{unit}</span>}
      </div>
      {note && <div className="v-metric__note">{note}</div>}
    </div>
  )
}

/** Equal-width metrics divided by hairlines. `cols` sets the grid. */
export function MetricRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <div className="v-metric-row" style={{ ['--metric-cols' as string]: cols }}>
      {children}
    </div>
  )
}

/* ----------------------------------------------------------------- Meter -- */

export function Meter({
  value,
  max = 100,
  tone = 'ok',
  /** Optional threshold marker, in the same units as `value`. */
  threshold,
  scale,
}: {
  value: number
  max?: number
  tone?: 'ok' | 'warn' | 'danger'
  threshold?: number
  scale?: [string, string]
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div>
      <div
        className="v-meter"
        role="meter"
        aria-valuenow={Number(value.toFixed(1))}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div className={`v-meter__fill v-meter__fill--${tone}`} style={{ width: `${pct}%` }} />
        {threshold !== undefined && (
          <div className="v-meter__tick" style={{ left: `${Math.min(100, (threshold / max) * 100)}%` }} />
        )}
      </div>
      {scale && (
        <div className="v-meter-scale">
          <Label>{scale[0]}</Label>
          <Label>{scale[1]}</Label>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- Button -- */

export type ButtonVariant = 'primary' | 'ok' | 'danger' | 'ghost' | 'danger-ghost'

export function Button({
  variant = 'ghost',
  size = 'md',
  block,
  busy,
  disabled,
  onClick,
  children,
  title,
}: {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
  /** Shows a working label and blocks input without changing layout width. */
  busy?: boolean
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled || busy}
      className={cx('v-btn', `v-btn--${variant}`, size !== 'md' && `v-btn--${size}`, block && 'v-btn--block')}
    >
      {busy ? 'Working…' : children}
    </button>
  )
}

/* ------------------------------------------------------------- Segmented -- */

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /** Leading colour swatch, used to key roles to their identity colour. */
  dot?: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  disabled?: boolean
}) {
  return (
    <div className="v-segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="v-segmented__item"
          data-role={o.value}
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ----------------------------------------------------------------- Field -- */

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="v-field">
      <Label>{label}</Label>
      {children}
      {hint && <div className="v-field__hint">{hint}</div>}
    </label>
  )
}

export function NumberInput({
  value,
  onChange,
  min = 0,
  step = 1,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  step?: number
}) {
  return (
    <input
      className="v-input"
      type="number"
      inputMode="decimal"
      min={min}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
    />
  )
}

export function DateInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input className="v-input" type="date" value={value} onChange={(e) => onChange(e.target.value)} />
}

/* ---------------------------------------------------------------- Banner -- */

export function Banner({
  tone,
  title,
  children,
  onDismiss,
}: {
  tone: 'danger' | 'warn' | 'info'
  title: string
  children: ReactNode
  onDismiss?: () => void
}) {
  return (
    <div className={`v-banner v-banner--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="v-tag__dot" style={{ marginTop: 7 }} />
      <div className="v-banner__body">
        <strong>{title}</strong> {children}
      </div>
      {onDismiss && (
        <button className="v-banner__close" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- Avatar -- */

export function Avatar({
  initials,
  tone = 'neutral',
  size = 'md',
}: {
  initials: string
  tone?: Tone
  size?: 'sm' | 'md' | 'lg'
}) {
  const bg = tone === 'neutral' ? 'var(--neutral-soft)' : `var(--${tone}-soft)`
  const fg = tone === 'neutral' ? 'var(--ink-500)' : `var(--${tone})`
  return (
    <span className={`v-avatar v-avatar--${size}`} style={{ background: bg, color: fg }} aria-hidden="true">
      {initials}
    </span>
  )
}
