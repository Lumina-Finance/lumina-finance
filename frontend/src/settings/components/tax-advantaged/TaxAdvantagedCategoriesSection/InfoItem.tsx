import type React from 'react'
import { CATEGORY_SUMMARY_VALUE_CLASS } from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/taxAdvantagedCategoryConstants'

export default function InfoItem({
  financial = false,
  label,
  labelAccessory,
  value,
}: {
  financial?: boolean
  label: string
  labelAccessory?: React.ReactNode
  value: string
}) {
  return (
    <div className={`h-14 min-w-0 ${labelAccessory ? 'overflow-visible' : 'overflow-hidden'}`}>
      <div className="mb-1 flex h-5 items-center gap-2">
        <p className="app-label block truncate leading-5">{label}</p>
        {labelAccessory}
      </div>
      <p className={`${financial ? 'font-financial' : ''} ${CATEGORY_SUMMARY_VALUE_CLASS}`}>
        {value}
      </p>
    </div>
  )
}

