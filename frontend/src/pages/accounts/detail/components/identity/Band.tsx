import type { ReactNode } from 'react'

/**
 * Frames the account status at the foot of the identity card, below a divider. From 750px the room on either side is
 * equal, and on a phone the room above is 20px
 *
 * From 750px the card has a minimum height and the auto margin keeps the band at its bottom. The room above the
 * divider is padding on an outer box, since an auto margin replaces any margin and would leave none once the
 * content fills the card
 */
export function IdentityBand({ children }: { children: ReactNode }) {
  return (
    <div className="mt-auto pt-5 min-[750px]:pt-4">
      <div className="pt-4" style={{ borderTop: '1px solid var(--app-border)' }}>
        {children}
      </div>
    </div>
  )
}
