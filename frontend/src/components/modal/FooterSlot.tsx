import type { ReactNode } from 'react'
import { useFooterKeepClear } from '@/components/modal/footerClearance'

/**
 * A panel's footer as it is drawn. With `keepsToastClear` it is marked, while the panel fills the
 * screen, so a message shown over the page sits above the whole of it. Without it the footer is drawn
 * unwrapped, and any marking is left to the footer itself
 */
export function ModalFooterSlot({ keepsToastClear, children }: { keepsToastClear: boolean; children: ReactNode }) {
  const keepClear = useFooterKeepClear()

  if (!keepsToastClear) return children
  return (
    <div className="shrink-0" {...keepClear}>
      {children}
    </div>
  )
}
