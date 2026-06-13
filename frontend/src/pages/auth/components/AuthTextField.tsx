import type { HTMLInputTypeAttribute, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'

interface AuthTextFieldProps {
  autoComplete: string
  error?: string
  id: string
  label: string
  labelSuffix?: ReactNode
  touched?: boolean
  type?: HTMLInputTypeAttribute
  value: string
  onBlur?: () => void
  onChange: (value: string) => void
  onFocus?: () => void
}

/**
 * Renders a labelled auth input with the inline animated validation message used across login and signup
 */
export function AuthTextField({
  autoComplete,
  error,
  id,
  label,
  labelSuffix,
  touched = false,
  type = 'text',
  value,
  onBlur,
  onChange,
  onFocus,
}: AuthTextFieldProps) {
  const showError = Boolean(touched && error)

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="app-label">
          {label}
          {labelSuffix}
        </label>
        <AnimatePresence>
          {showError && (
            <motion.p
              key={`${id}-error`}
              className="text-xs"
              style={{ color: 'var(--app-negative)' }}
              initial={{ opacity: 0, x: 4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 4 }}
              transition={{ duration: 0.2 }}
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        className={`app-input ${showError ? 'app-input-error' : ''}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    </div>
  )
}

