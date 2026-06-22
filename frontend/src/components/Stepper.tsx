import { Fragment } from 'react'
import type { Status } from '../types'
import { ACCENT, STEP_INDEX, STEP_LABELS } from '../state'

export function Stepper({ status }: { status: Status }) {
  const cur = STEP_INDEX[status]
  const isLiq = status === 'liquidated'
  const termColor = isLiq ? '#d94b3a' : '#2ea36a'
  const labels = STEP_LABELS(status)

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
      {labels.map((labelText, i) => {
        const reached = i <= cur
        const current = i === cur
        const isTerm = i === 3
        const fill = reached ? (isTerm ? termColor : ACCENT) : '#e8eaee'
        let text: string
        if (reached && (i < cur || (current && isTerm))) text = isLiq && isTerm ? '✕' : '✓'
        else text = String(i + 1)
        const lineReached = i + 1 <= cur
        const lineColor = lineReached ? (i + 1 === 3 ? termColor : ACCENT) : '#e8eaee'

        return (
          <div
            key={labelText}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flex: i < 3 ? 1 : '0 0 auto' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  background: fill,
                  color: reached ? '#fff' : '#9aa1ad',
                  fontFamily: "'IBM Plex Mono',monospace",
                  fontSize: 12,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 'none',
                  transition: 'all .3s',
                }}
              >
                {text}
              </div>
              {i < 3 && (
                <Fragment>
                  <div style={{ flex: 1, height: 2, background: lineColor, margin: '0 6px', borderRadius: 999, transition: 'background .3s' }} />
                </Fragment>
              )}
            </div>
            <div style={{ marginTop: 9, fontSize: 12, fontWeight: current ? 600 : 500, color: reached ? '#14171f' : '#9aa1ad' }}>
              {labelText}
            </div>
          </div>
        )
      })}
    </div>
  )
}
