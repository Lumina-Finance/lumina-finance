import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { RefreshCw } from 'lucide-react'
import { useServerNotice, type ServerNotice as Notice } from '@/api/version'
import { INFO_CALLOUT_ACTION_CLASS, InfoCallout } from '@/components/InfoCallout'

export const UPDATE_MESSAGE =
  'A new version of Lumina Finance is available. Please save your work and reload to update.'

const NOTICE_EASE = [0.22, 1, 0.36, 1] as const
const NOTICE_SECONDS = 0.3

function reload() {
  window.location.reload()
}

/**
 * Tells the user when the server runs another version than this page, at the top of the page content
 *
 * It never interrupts what the user is doing: it takes no focus, covers nothing and doesn't reload by
 * itself, so a form keeps its input until the user presses Reload. The region is always present and
 * empty while there is nothing to say, so a screen reader announces the notice as it appears. A
 * maintenance shows nothing here, since the maintenance screen covers the whole app instead
 */
export function ServerNotice() {
  return <ServerNoticeView notice={useServerNotice()} />
}

/** Draws the update notice, or nothing for any other notice */
export function ServerNoticeView({ notice }: { notice: Notice | null }) {
  const shouldReduceMotion = useReducedMotion() ?? false
  const duration = shouldReduceMotion ? 0 : NOTICE_SECONDS

  // Below the width where the sidebar shows, the menu button floats over the top right of the page, so
  // the region stops short of it and nothing of the notice runs underneath
  return (
    <div role="status" className="max-[1049px]:pr-14">
      <AnimatePresence initial={false}>
        {notice === 'update' && (
          <motion.div
            key="update"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration, ease: NOTICE_EASE }}
            className="overflow-hidden"
          >
            <div className="pb-4 text-pretty">
              <InfoCallout
                icon={RefreshCw}
                action={
                  <button type="button" className={INFO_CALLOUT_ACTION_CLASS} onClick={reload}>
                    Reload
                  </button>
                }
              >
                {UPDATE_MESSAGE}
              </InfoCallout>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
