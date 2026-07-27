import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import { ImportStep } from '@/pages/imports/components'
import type { ImportDataSource } from '@/pages/imports/types'

// The Firefly III flow is newer and converts most of an export but not all of
// it, so the option is flagged as beta up front rather than letting that only
// surface once a file is staged
const DATA_SOURCE_OPTIONS: DropdownOption[] = [
  { value: 'generic', label: 'Generic CSV' },
  { value: 'firefly', label: 'Firefly III', badge: 'Beta' },
]

/**
 * First step of the import flow, letting the user choose which app the export came from before any
 * file is staged
 */
export function ImportSourceStep({
  value,
  onChange,
}: {
  value: ImportDataSource
  onChange: (value: ImportDataSource) => void
}) {
  return (
    <ImportStep
      index="00"
      title="Data Source"
      description="Choose the app the export came from."
    >
      <Dropdown
        options={DATA_SOURCE_OPTIONS}
        value={value}
        onChange={(next) => onChange(next as ImportDataSource)}
        className="app-input"
      />
    </ImportStep>
  )
}
