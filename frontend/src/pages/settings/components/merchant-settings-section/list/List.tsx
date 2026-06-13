import type { RefObject, UIEvent } from 'react'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import type { Category } from '@/api/categories'
import type { Merchant } from '@/api/merchants'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import ScrollableListMoreButton from '@/components/list-controls/MoreButton'
import MerchantRow from '@/pages/settings/components/merchant-settings-section/list/Row'
import MobileMerchantRow from '@/pages/settings/components/merchant-settings-section/list/MobileRow'

export default function MerchantSettingsList({
  activeSearch,
  categoryById,
  categoryOptions,
  confirmingDeleteMerchantId,
  deletingMerchantId,
  editingMerchantId,
  hasMoreMerchants,
  merchantListRef,
  shouldScrollMerchants,
  showFetchingMoreMerchants,
  showInitialMerchantLoading,
  showMerchantListEnd,
  showMerchantListMoreIndicator,
  visibleMerchants,
  onDeleteCancel,
  onDeleteConfirm,
  onDeleteRequest,
  onEdit,
  onEditCancel,
  onListMoreClick,
  onListScroll,
}: {
  activeSearch: string
  categoryById: Map<string, Category>
  categoryOptions: DropdownOption[]
  confirmingDeleteMerchantId: string | null
  deletingMerchantId: string | null
  editingMerchantId: string | null
  hasMoreMerchants: boolean
  merchantListRef: RefObject<HTMLDivElement | null>
  shouldScrollMerchants: boolean
  showFetchingMoreMerchants: boolean
  showInitialMerchantLoading: boolean
  showMerchantListEnd: boolean
  showMerchantListMoreIndicator: boolean
  visibleMerchants: Merchant[]
  onDeleteCancel: () => void
  onDeleteConfirm: (merchant: Merchant) => void | Promise<void>
  onDeleteRequest: (merchant: Merchant) => void
  onEdit: (merchant: Merchant) => void
  onEditCancel: () => void
  onListMoreClick: () => void
  onListScroll: (event: UIEvent<HTMLDivElement>) => void
}) {
  const shouldReduceMotion = useReducedMotion()

  if (visibleMerchants.length === 0 && !showInitialMerchantLoading) {
    return (
      <p className="py-3 text-center text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
        {activeSearch.trim() ? 'No merchants match your search.' : 'No merchants yet.'}
      </p>
    )
  }

  return (
    <div className="relative">
      <div
        ref={merchantListRef}
        className={shouldScrollMerchants ? 'max-h-[35rem] min-w-0 overflow-x-auto overflow-y-auto pr-2' : 'min-w-0 overflow-x-auto'}
        onScroll={shouldScrollMerchants ? onListScroll : undefined}
      >
        <div className="min-[750px]:hidden">
          <AnimatePresence initial={false}>
            {visibleMerchants.map((merchant, index) => (
              <MobileMerchantRow
                key={merchant.id}
                categoryById={categoryById}
                categoryOptions={categoryOptions}
                confirmingDelete={confirmingDeleteMerchantId === merchant.id}
                deleting={deletingMerchantId === merchant.id}
                isEditing={editingMerchantId === merchant.id}
                isLast={!showMerchantListEnd && !hasMoreMerchants && index === visibleMerchants.length - 1}
                merchant={merchant}
                shouldReduceMotion={shouldReduceMotion}
                onDeleteCancel={onDeleteCancel}
                onDeleteConfirm={onDeleteConfirm}
                onDeleteRequest={onDeleteRequest}
                onEdit={onEdit}
                onEditCancel={onEditCancel}
              />
            ))}
          </AnimatePresence>
          {showMerchantListEnd && !showFetchingMoreMerchants && !showInitialMerchantLoading && (
            <p
              className="py-4 text-center text-sm italic"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              You've reached the end.
            </p>
          )}
          {showFetchingMoreMerchants && visibleMerchants.length > 0 && (
            <p
              className="py-4 text-center text-sm italic"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              Fetching more
            </p>
          )}
          {showInitialMerchantLoading && visibleMerchants.length === 0 && (
            <p
              className="py-4 text-center text-sm italic"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              Loading merchants...
            </p>
          )}
        </div>

        <table className="hidden w-full table-auto text-left text-[0.9375rem] min-[750px]:table">
          <colgroup>
            <col style={{ width: '1%' }} />
            <col />
            <col style={{ width: '7rem' }} />
          </colgroup>
          <thead>
            <tr style={{ color: 'var(--app-text-muted)', borderBottom: '1px solid var(--app-border)' }}>
              <th
                scope="col"
                className={`app-label whitespace-nowrap py-3 pl-4 pr-6 ${shouldScrollMerchants ? 'sticky top-0 z-10' : ''}`}
                style={{ background: 'var(--app-surface-soft)' }}
              >
                Merchant
              </th>
              <th
                scope="col"
                className={`app-label py-3 pr-4 ${shouldScrollMerchants ? 'sticky top-0 z-10' : ''}`}
                style={{ background: 'var(--app-surface-soft)' }}
              >
                Default category
              </th>
              <th
                scope="col"
                className={`app-label py-3 pr-4 text-right ${shouldScrollMerchants ? 'sticky top-0 z-10' : ''}`}
                style={{ background: 'var(--app-surface-soft)' }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {visibleMerchants.map((merchant, index) => (
                <MerchantRow
                  key={merchant.id}
                  categoryById={categoryById}
                  categoryOptions={categoryOptions}
                  confirmingDelete={confirmingDeleteMerchantId === merchant.id}
                  deleting={deletingMerchantId === merchant.id}
                  isEditing={editingMerchantId === merchant.id}
                  isLast={!showMerchantListEnd && !hasMoreMerchants && index === visibleMerchants.length - 1}
                  merchant={merchant}
                  shouldReduceMotion={shouldReduceMotion}
                  onDeleteCancel={onDeleteCancel}
                  onDeleteConfirm={onDeleteConfirm}
                  onDeleteRequest={onDeleteRequest}
                  onEdit={onEdit}
                  onEditCancel={onEditCancel}
                />
              ))}
            </AnimatePresence>
            {showMerchantListEnd && !showFetchingMoreMerchants && !showInitialMerchantLoading && (
              <tr>
                <td colSpan={3}>
                  <p
                    className="py-4 text-center text-sm italic"
                    style={{ color: 'var(--app-text-subtle)' }}
                  >
                    You've reached the end.
                  </p>
                </td>
              </tr>
            )}
            {showFetchingMoreMerchants && visibleMerchants.length > 0 && (
              <tr>
                <td colSpan={3}>
                  <p
                    className="py-4 text-center text-sm italic"
                    style={{ color: 'var(--app-text-subtle)' }}
                  >
                    Fetching more
                  </p>
                </td>
              </tr>
            )}
            {showInitialMerchantLoading && visibleMerchants.length === 0 && (
              <tr>
                <td colSpan={3}>
                  <p
                    className="py-4 text-center text-sm italic"
                    style={{ color: 'var(--app-text-subtle)' }}
                  >
                    Loading merchants...
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ScrollableListMoreButton
        show={showMerchantListMoreIndicator}
        onClick={onListMoreClick}
        ariaLabel={hasMoreMerchants ? 'Show more merchants' : 'Scroll merchants down'}
      />
    </div>
  )
}
