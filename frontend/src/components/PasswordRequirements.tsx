import { Check, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { NEW_PASSWORD_RULES } from '@/utils/passwordPolicy'

interface PasswordRequirementsProps {
  password: string
  // Each caller decides its own show/hide policy, such as field focus, touched state, or plain
  // non-emptiness, and passes the resulting boolean here rather than the component inferring it
  visible: boolean
  // Wraps the checklist in a mount and unmount animation instead of rendering it directly
  animated?: boolean
  // Animates margin-top up to this value instead of leaving it static, for a caller with no margin
  // already reserved above the checklist
  animatedMarginTop?: number
  className?: string
}

/**
 * Renders the password policy checklist, marking each rule passed or failing as the password changes
 */
export function PasswordRequirements({
  password,
  visible,
  animated = false,
  animatedMarginTop,
  className = 'space-y-1',
}: PasswordRequirementsProps) {
  const rules = NEW_PASSWORD_RULES.map((rule) => {
    const passed = rule.test(password)
    return (
      <li key={rule.label} className="flex items-center gap-2 text-sm transition-colors duration-200">
        {passed ? (
          <Check size={14} strokeWidth={2.5} style={{ color: 'var(--app-accent)' }} aria-hidden />
        ) : (
          <X size={14} strokeWidth={2.5} style={{ color: 'var(--app-text-muted)' }} aria-hidden />
        )}
        <span
          className={passed ? 'line-through' : ''}
          style={{ color: passed ? 'var(--app-text-subtle)' : 'var(--app-text-muted)' }}
        >
          {rule.label}
        </span>
      </li>
    )
  })

  if (!animated) {
    return visible ? <ul className={className}>{rules}</ul> : null
  }

  // marginTop only joins the animated variants when a caller asks for it, since an inline style
  // from motion would otherwise override a static margin utility class every frame
  const hasMarginAnimation = animatedMarginTop !== undefined

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.ul
          className={className}
          initial={{ height: 0, opacity: 0, ...(hasMarginAnimation ? { marginTop: 0 } : {}) }}
          animate={{ height: 'auto', opacity: 1, ...(hasMarginAnimation ? { marginTop: animatedMarginTop } : {}) }}
          exit={{ height: 0, opacity: 0, ...(hasMarginAnimation ? { marginTop: 0 } : {}) }}
          transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        >
          {rules}
        </motion.ul>
      )}
    </AnimatePresence>
  )
}
