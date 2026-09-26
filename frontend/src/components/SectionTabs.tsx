export type SectionKey = 'position' | 'book' | 'disclosure' | 'holdings' | 'activity' | 'ledger'

export const SECTION_KEYS: SectionKey[] = ['position', 'book', 'disclosure', 'holdings', 'activity', 'ledger']

export const isSectionKey = (v: unknown): v is SectionKey => SECTION_KEYS.includes(v as SectionKey)

export interface SectionDef {
  key: SectionKey
  label: string
  /** Rendered as a small counter beside the label. Zero is omitted: an empty
   * section should not advertise its emptiness in the navigation. */
  count?: number
}

/** Section navigation. The page shows one instrument at a time instead of a
 * single scroll of stacked panels — disclosure, holdings, the activity log and
 * the raw ledger response each get their own view. */
export function SectionTabs({
  sections,
  active,
  onSelect,
}: {
  sections: SectionDef[]
  active: SectionKey
  onSelect: (key: SectionKey) => void
}) {
  return (
    <div className="v-tabs">
      <div className="v-tabs__inner" role="tablist" aria-label="Sections">
        {sections.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            className="v-tab"
            aria-selected={s.key === active}
            onClick={() => onSelect(s.key)}
          >
            {s.label}
            {!!s.count && <span className="v-tab__count">{s.count}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
