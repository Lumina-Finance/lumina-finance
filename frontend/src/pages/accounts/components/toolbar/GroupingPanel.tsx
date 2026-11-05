import { useId, useMemo, useState } from 'react'
import { Layers } from 'lucide-react'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import { Switch } from '@/components/forms/Switch'
import { FilterGlassPanel } from '@/components/list-controls/FilterGlassPanel'
import { ACCOUNT_GROUPINGS, type AccountGrouping } from '@/pages/accounts/utils/accountGroups'
import { joinClassNames } from '@/utils/classNames'

// Open width of the glass, wide enough for the longest grouping name beside its dropdown chevron
const OPEN_WIDTH = 268

const NO_SECOND_LEVEL = 'none'

export type AccountGroupingSettings = {
  grouping: AccountGrouping
  onGroupingChange: (grouping: AccountGrouping) => void
  thenBy: AccountGrouping | null
  onThenByChange: (grouping: AccountGrouping | null) => void
  showLogos: boolean
  onShowLogosChange: (show: boolean) => void
  keepExpanded: boolean
  onKeepExpandedChange: (keep: boolean) => void
}

/**
 * Renders the grouping settings: the first and second grouping level, whether bank logos show and
 * whether every top-level group starts open. Shared by the desktop panel and the phone's full-screen
 * sheet
 */
export function GroupingPanelBody({
  settings,
  mobile = false,
}: {
  settings: AccountGroupingSettings
  // The phone's sheet draws its fields at the Filters sheet's size and its switch rows as 44px touch targets
  mobile?: boolean
}) {
  const fieldSize = mobile ? 'field' : 'compact'
  const switchRowClassName = joinClassNames(
    'flex cursor-pointer items-center justify-between gap-3 text-sm',
    mobile && 'min-h-11',
  )
  const firstId = useId()
  const secondId = useId()
  const logosId = useId()
  const expandedId = useId()

  const firstOptions = useMemo<DropdownOption[]>(
    () => ACCOUNT_GROUPINGS.map((option) => ({ value: option.id, label: option.label })),
    [],
  )
  // The second level can't repeat the first, and may be left out
  const secondOptions = useMemo<DropdownOption[]>(
    () => [
      { value: NO_SECOND_LEVEL, label: 'None' },
      ...ACCOUNT_GROUPINGS.filter((option) => option.id !== settings.grouping).map((option) => ({
        value: option.id,
        label: option.label,
      })),
    ],
    [settings.grouping],
  )

  return (
    <div className="flex flex-col gap-3 pt-1">
      <div>
        <p id={firstId} className="mb-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
          Group by
        </p>
        <Dropdown
          labelledBy={firstId}
          size={fieldSize}
          matchFieldWidth
          options={firstOptions}
          value={settings.grouping}
          onChange={(value) => settings.onGroupingChange(value as AccountGrouping)}
        />
      </div>

      <div>
        <p id={secondId} className="mb-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
          Then by
        </p>
        <Dropdown
          labelledBy={secondId}
          size={fieldSize}
          matchFieldWidth
          options={secondOptions}
          value={settings.thenBy ?? NO_SECOND_LEVEL}
          onChange={(value) => settings.onThenByChange(value === NO_SECOND_LEVEL ? null : (value as AccountGrouping))}
        />
      </div>

      <label htmlFor={logosId} className={switchRowClassName}>
        <span>Show bank logos</span>
        <Switch id={logosId} checked={settings.showLogos} onChange={settings.onShowLogosChange} />
      </label>

      <label htmlFor={expandedId} className={switchRowClassName}>
        <span>Keep groups expanded</span>
        <Switch id={expandedId} checked={settings.keepExpanded} onChange={settings.onKeepExpandedChange} />
      </label>
    </div>
  )
}

/**
 * Renders the grouping control as the Filters pill's twin: a pill that opens a panel holding the
 * grouping settings. Phones use the full-screen sheet instead
 */
export function GroupingPanel({ settings }: { settings: AccountGroupingSettings }) {
  const [open, setOpen] = useState(false)

  return (
    <FilterGlassPanel
      ariaLabel="Account grouping"
      label="Group by"
      icon={Layers}
      openWidth={OPEN_WIDTH}
      fitContent
      floatingContent
      open={open}
      onOpenChange={setOpen}
      activeFacetCount={0}
    >
      <GroupingPanelBody settings={settings} />
    </FilterGlassPanel>
  )
}
