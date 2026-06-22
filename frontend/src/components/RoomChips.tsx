import type { Role } from '../types'
import { ACCENT, PARTY_DEFS } from '../state'

/** "In the room" — the parties who can see this contract, with the active
 * role highlighted. Everyone else is explicitly shown as seeing nothing. */
export function RoomChips({ role }: { role: Role }) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {PARTY_DEFS.map((p) => {
        const isYou = p.key === role
        return (
          <div
            key={p.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 13px',
              borderRadius: 10,
              border: isYou ? `1px solid ${ACCENT}` : '1px solid #eef0f3',
              background: isYou ? '#fbfcff' : '#fff',
              boxShadow: isYou ? '0 0 0 3px rgba(39,72,216,0.08)' : 'none',
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: p.avatarBg,
                color: p.avatarColor,
                fontFamily: "'IBM Plex Mono',monospace",
                fontWeight: 600,
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 'none',
              }}
            >
              {p.initials}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#14171f', display: 'flex', alignItems: 'center', gap: 6 }}>
                {p.role}
                {isYou && (
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: ACCENT, background: '#eef2fe', padding: '1px 5px', borderRadius: 4 }}>
                    YOU
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: '#9aa1ad' }}>{p.sub}</div>
            </div>
          </div>
        )
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', border: '1px dashed #dfe2e7', borderRadius: 10, opacity: 0.8 }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: '#f4f5f7', color: '#bcc2cb', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          ?
        </div>
        <div style={{ fontSize: 11, color: '#aeb4be', lineHeight: 1.3 }}>
          Everyone else
          <br />
          sees nothing
        </div>
      </div>
    </div>
  )
}
