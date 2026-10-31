import { useId } from 'react'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import { ImportStep } from '@/pages/imports/components'
import type { ImportDataSource } from '@/pages/imports/types'

// The provider flows are newer and convert most of an export but not all of
// it, so their options are flagged as beta up front rather than letting that
// only surface once a file is staged
const DATA_SOURCE_OPTIONS: DropdownOption[] = [
  { value: 'generic', label: 'CSV' },
  { value: 'ofx', label: 'OFX/QFX' },
  { value: 'firefly', label: 'Firefly III', badge: 'Beta' },
  { value: 'actual', label: 'Actual Budget', badge: 'Beta' },
]

/**
 * First step of the import flow, letting the user choose which app the export came from before any
 * file is staged
 *
 * @param sources - The sources offered, every one when left out. They keep the order of the options
 *   above, whatever order this lists them in
 */
export function ImportSourceStep({
  value,
  sources,
  onChange,
}: {
  value: ImportDataSource
  sources?: readonly ImportDataSource[]
  onChange: (value: ImportDataSource) => void
}) {
  const titleId = useId()

  return (
    <ImportStep index="00" title="Data source" titleId={titleId} description="Choose the app the export came from.">
      <Dropdown
        labelledBy={titleId}
        options={
          sources
            ? DATA_SOURCE_OPTIONS.filter((option) => sources.includes(option.value as ImportDataSource))
            : DATA_SOURCE_OPTIONS
        }
        value={value}
        onChange={(next) => onChange(next as ImportDataSource)}
      />
    </ImportStep>
  )
}
