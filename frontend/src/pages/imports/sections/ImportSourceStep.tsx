import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import { ImportStep } from '../components'
import type { ImportDataSource } from '../types'

const DATA_SOURCE_OPTIONS: DropdownOption[] = [
  { value: 'generic', label: 'Generic CSV' },
  { value: 'firefly', label: 'Firefly III' },
]

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
