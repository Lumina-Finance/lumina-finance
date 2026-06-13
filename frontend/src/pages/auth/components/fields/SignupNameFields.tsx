import { AnimatePresence, motion } from 'motion/react'
import { AuthTextField } from './TextField'
import { SIGNUP_FIELD_ANIMATION } from '@/pages/auth/constants/authAnimations'
import type { AuthFieldErrors, AuthFormValues } from '@/pages/auth/utils/authForm'

interface AuthSignupNameFieldsProps {
  errors: AuthFieldErrors
  form: AuthFormValues
  show: boolean
  touched: Record<string, boolean>
  onFieldBlur: (field: keyof AuthFieldErrors) => void
  onFieldChange: (field: keyof AuthFormValues, value: string) => void
}

/**
 * Renders signup-only name fields with the shared slide animation
 */
export function AuthSignupNameFields({
  errors,
  form,
  show,
  touched,
  onFieldBlur,
  onFieldChange,
}: AuthSignupNameFieldsProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div className="space-y-5 overflow-hidden" {...SIGNUP_FIELD_ANIMATION}>
          <AuthTextField
            id="first_name"
            label="First name"
            autoComplete="given-name"
            value={form.first_name}
            touched={touched.first_name}
            error={errors.first_name}
            onChange={(value) => onFieldChange('first_name', value)}
            onBlur={() => onFieldBlur('first_name')}
          />

          <AuthTextField
            id="last_name"
            label="Last name"
            labelSuffix={<span style={{ color: 'var(--app-text-subtle)' }}> (optional)</span>}
            autoComplete="family-name"
            value={form.last_name}
            onChange={(value) => onFieldChange('last_name', value)}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
