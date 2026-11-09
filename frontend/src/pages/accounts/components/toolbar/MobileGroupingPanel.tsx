import { useCallback, useState } from 'react'
import { Layers } from 'lucide-react'
import { MobileFilterSheet } from '@/components/list-controls/MobileFilterSheet'
import { GroupingPanelBody, type AccountGroupingSettings } from '@/pages/accounts/components/toolbar/GroupingPanel'
import { getGroupingSummary } from '@/pages/accounts/utils/accountGroups'

/**
 * Renders the phone's grouping control: a pill that opens the grouping settings in the same
 * full-screen sheet the filters use. Changes apply as they are made, so the sheet has no footer
 */
export function MobileGroupingPanel({ settings }: { settings: AccountGroupingSettings }) {
  const [isOpen, setIsOpen] = useState(false)
  // Kept mounted until the close animation ends, as the filter sheet is
  const [isMounted, setIsMounted] = useState(false)

  const open = useCallback(() => {
    setIsMounted(true)
    setIsOpen(true)
  }, [])

  return (
    <>
      <button
        type="button"
        className="app-glass-button h-11 min-w-0 flex-1 justify-between"
        aria-label="Account grouping"
        aria-haspopup="dialog"
        onClick={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Layers size={17} aria-hidden />
          <span>Group by</span>
        </span>
      </button>

      {isMounted && (
        <MobileFilterSheet
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          onExitComplete={() => {
            if (!isOpen) setIsMounted(false)
          }}
          ariaLabel="Account grouping"
          title="Group by"
          summary={getGroupingSummary(settings.grouping, settings.thenBy)}
          showFooter={false}
          largeCloseButton
        >
          {() => <GroupingPanelBody settings={settings} mobile />}
        </MobileFilterSheet>
      )}
    </>
  )
}
