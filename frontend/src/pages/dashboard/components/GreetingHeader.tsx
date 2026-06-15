import { AnimatePresence, motion } from 'motion/react'

const DASHBOARD_GREETING_CHARACTER_TRANSITION = {
  duration: 0.3,
  ease: [0.25, 0.1, 0.25, 1.04],
} as const

const DASHBOARD_GREETING_TITLE_VARIANTS = {
  initial: { transition: { staggerChildren: 0.03 } },
  enter: { transition: { staggerChildren: 0.03 } },
  exit: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
} as const

const DASHBOARD_GREETING_CHARACTER_VARIANTS = {
  initial: { y: 40, opacity: 0 },
  enter: { y: 0, opacity: 1 },
  exit: { y: -40, opacity: 0 },
} as const

const DASHBOARD_GREETING_SUBTITLE_TRANSITION = {
  duration: 0.22,
  ease: [0.42, 0, 0.58, 1],
} as const

const DASHBOARD_GREETING_TITLE_BLEED = 'calc(var(--app-page-title-size) * 0.16)'
const DASHBOARD_GREETING_TITLE_NEGATIVE_BLEED = 'calc(var(--app-page-title-size) * -0.16)'
const DASHBOARD_GREETING_RESERVED_SUBTITLE = 'Your finances can wait, your sleep can\u2019t.'

/**
 * Renders the dashboard greeting with separate title and subtitle transition styles
 */
export function DashboardGreetingHeader({
  greeting,
  subtitle,
}: {
  greeting: string
  subtitle: string
}) {
  return (
    <header className="app-page-header">
      <div className="relative" style={{ height: 'var(--app-page-title-size)' }}>
        <div
          className="absolute inset-x-0 overflow-hidden"
          style={{
            bottom: DASHBOARD_GREETING_TITLE_NEGATIVE_BLEED,
            paddingTop: DASHBOARD_GREETING_TITLE_BLEED,
            top: DASHBOARD_GREETING_TITLE_NEGATIVE_BLEED,
          }}
        >
          <AnimatePresence initial={false} mode="wait">
            <motion.h1
              key={greeting}
              className="app-page-title flex whitespace-nowrap"
              initial="initial"
              animate="enter"
              exit="exit"
              variants={DASHBOARD_GREETING_TITLE_VARIANTS}
            >
              {greeting.split('').map((char, index) => (
                <motion.span
                  key={`${greeting}-${index}`}
                  className={char === ' ' ? 'inline-block w-[0.28em]' : 'inline-block'}
                  variants={DASHBOARD_GREETING_CHARACTER_VARIANTS}
                  transition={DASHBOARD_GREETING_CHARACTER_TRANSITION}
                >
                  {char}
                </motion.span>
              ))}
            </motion.h1>
          </AnimatePresence>
        </div>
      </div>

      <div className="relative">
        <p className="app-page-description invisible" aria-hidden>
          {DASHBOARD_GREETING_RESERVED_SUBTITLE}
        </p>
        <AnimatePresence initial={false} mode="wait">
          <motion.p
            key={subtitle}
            className="app-page-description absolute inset-x-0 top-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={DASHBOARD_GREETING_SUBTITLE_TRANSITION}
          >
            {subtitle}
          </motion.p>
        </AnimatePresence>
      </div>
    </header>
  )
}
