import { Check, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { NEW_PASSWORD_RULES, isNewPasswordValid } from '@/utils/passwordPolicy'

interface PasswordRequirementsProps {
  focused: boolean
  password: string
  touched: boolean | undefined
}

/**
 * Renders signup password rules while hiding the checklist after a touched valid password
 */
export function PasswordRequirements({
  focused,
  password,
  touched,
}: PasswordRequirementsProps) {
  const passwordIsValid = isNewPasswordValid(password)
  const showRequirements = (focused || password.length > 0) && !(touched && passwordIsValid)

  return (
    <AnimatePresence>
      {showRequirements && (
        <motion.ul
          className="mt-2 space-y-1"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {NEW_PASSWORD_RULES.map((rule) => {
            const passed = rule.test(password)
            return (
              <li key={rule.label} className="flex items-center gap-2 text-sm transition-colors duration-200">
                {passed ? (
                  <Check size={14} strokeWidth={2.5} style={{ color: 'var(--app-accent)' }} aria-hidden />
                ) : (
                  <X size={14} strokeWidth={2.5} style={{ color: 'var(--app-accent)' }} aria-hidden />
                )}
                <span
                  className={passed ? 'line-through' : ''}
                  style={{ color: passed ? 'var(--app-text-subtle)' : 'var(--app-text-muted)' }}
                >
                  {rule.label}
                </span>
              </li>
            )
          })}
        </motion.ul>
      )}
    </AnimatePresence>
  )
}
