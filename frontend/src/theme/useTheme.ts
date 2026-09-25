import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'veil.theme'

/** Read the persisted choice. Storage can throw or be unavailable (private
 * windows, blocked site data), so every access is guarded and falls back to the
 * product default rather than failing the render. */
function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

/** Theme state bound to `data-theme` on <html>.
 *
 * Dark is the product default: the design is built on the charcoal ground and
 * that is the canonical look. Light is available from the top-bar control. The
 * OS preference is deliberately not consulted, so the product presents one
 * identity and the control is the only switch.
 *
 * The choice is written to storage only when the viewer toggles it. A session
 * that never touches the control leaves Web Storage empty — the role-auth
 * browser check asserts exactly that, alongside "no stored credential". */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => readStored() ?? 'dark')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'light' ? 'dark' : 'light'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // Preference is a convenience only; losing it must not break the app.
      }
      return next
    })
  }, [])

  return { theme, toggle }
}
