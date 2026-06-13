import { AnimatePresence, motion } from 'motion/react'
import type { Currency } from '@/api/currency'
import Dropdown, { type DropdownOption } from '@/components/Dropdown'
import { SIGNUP_FIELD_ANIMATION } from '@/pages/auth/constants/authAnimations'
import { buildCurrencyOptions, type AuthFormValues } from '@/pages/auth/utils/authForm'

interface AuthSignupReferenceFieldsProps {
  currencies: Currency[]
  currencyPlaceholder: string
  form: AuthFormValues
  show: boolean
  timezones: DropdownOption[]
  onFieldChange: (field: keyof AuthFormValues, value: string) => void
}

/**
 * Renders signup-only reference-data dropdowns for base currency and timezone
 */
export function AuthSignupReferenceFields({
  currencies,
  currencyPlaceholder,
  form,
  show,
  timezones,
  onFieldChange,
}: AuthSignupReferenceFieldsProps) {
  return (
    <>
      <AnimatePresence>
        {show && (
          <motion.div className="space-y-1.5" {...SIGNUP_FIELD_ANIMATION}>
            <label htmlFor="base_currency" className="app-label block">Base currency</label>
            <Dropdown
              id="base_currency"
              options={buildCurrencyOptions(currencies)}
              value={form.base_currency}
              onChange={(value) => onFieldChange('base_currency', value)}
              placeholder={currencyPlaceholder}
              searchable
              searchPlaceholder="Search currencies..."
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {show && (
          <motion.div className="space-y-1.5" {...SIGNUP_FIELD_ANIMATION}>
            <label htmlFor="tz" className="app-label block">Timezone</label>
            <Dropdown
              id="tz"
              options={timezones}
              value={form.tz}
              onChange={(value) => onFieldChange('tz', value)}
              searchable
              searchPlaceholder="Search timezones..."
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
