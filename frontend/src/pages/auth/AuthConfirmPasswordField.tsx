import { AnimatePresence, motion } from 'motion/react'
import { AuthTextField } from './AuthTextField'
import { SIGNUP_FIELD_ANIMATION } from './authAnimations'
import type { AuthFieldErrors, AuthFormValues } from './authForm'

interface AuthConfirmPasswordFieldProps {
  error?: string
  show: boolean
  touched: boolean | undefined
  value: string
  onFieldBlur: (field: keyof AuthFieldErrors) => void
  onFieldChange: (field: keyof AuthFormValues, value: string) => void
}

/**
 * Renders the signup-only confirm-password field with validation animation
 */
export function AuthConfirmPasswordField({
  error,
  show,
  touched,
  value,
  onFieldBlur,
  onFieldChange,
}: AuthConfirmPasswordFieldProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div className="overflow-hidden" {...SIGNUP_FIELD_ANIMATION}>
          <AuthTextField
            id="confirm_password"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={value}
            touched={touched}
            error={error}
            onChange={(nextValue) => onFieldChange('confirm_password', nextValue)}
            onBlur={() => onFieldBlur('confirm_password')}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

