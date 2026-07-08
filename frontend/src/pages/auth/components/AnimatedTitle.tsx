import { AnimatePresence, motion } from 'motion/react'
import type { AuthMode } from '@/pages/auth/utils/authForm'

/**
 * Renders the animated auth heading when the route switches between login and signup
 */
export function AuthAnimatedTitle({ mode }: { mode: AuthMode }) {
  const title = mode === 'login' ? 'Login' : mode === 'signup' ? 'Sign up' : 'Password Reset'

  return (
    <div className="overflow-hidden" style={{ height: '2.75rem' }}>
      <AnimatePresence mode="wait">
        <motion.h1
          key={mode}
          className="flex font-serif text-4xl font-normal tracking-tight"
          initial="initial"
          animate="enter"
          exit="exit"
          variants={{
            initial: { transition: { staggerChildren: 0.03 } },
            enter: { transition: { staggerChildren: 0.03 } },
            exit: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
          }}
        >
          {title.split('').map((char, index) => (
            <motion.span
              key={`${mode}-${index}`}
              className={char === ' ' ? 'inline-block w-2' : 'inline-block'}
              variants={{
                initial: { y: 40, opacity: 0 },
                enter: { y: 0, opacity: 1 },
                exit: { y: -40, opacity: 0 },
              }}
              transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1.04] }}
            >
              {char}
            </motion.span>
          ))}
        </motion.h1>
      </AnimatePresence>
    </div>
  )
}
