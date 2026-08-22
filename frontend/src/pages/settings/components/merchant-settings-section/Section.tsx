import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import { ApiError } from '@/api/auth'
import { useCategories } from '@/api/categories'
import {
  useDeleteMerchant,
  useMergeMerchant,
  useRefreshMerchants,
  type Merchant,
} from '@/api/merchants'
import CreateMerchantModal from '@/components/reference-modals/CreateMerchantModal'
import LoadingRegion from '@/components/loading/Region'
import MerchantSettingsList from '@/pages/settings/components/merchant-settings-section/list/List'
import MergeDeleteMerchantModal from '@/pages/settings/components/merchant-settings-section/modals/MergeDeleteModal'
import { DELETE_SPINNER_MS } from '@/pages/settings/components/merchant-settings-section/constants'
import { categoryOptions } from '@/pages/settings/components/merchant-settings-section/utils'
import { useMerchantSettingsList } from '@/pages/settings/components/merchant-settings-section/hooks/useList'
import SettingsSectionHeader from '@/pages/settings/components/SectionHeader'
import SettingsCard from '@/pages/settings/components/Card'
import { SETTINGS_LIST_LOADING_OVERLAY_CLASS } from '@/pages/settings/components/shared/constants'
import { waitForMilliseconds } from '@/utils/timing'

/**
 * Settings section for managing merchants, combining search, creation, inline editing and
 * deletion with the list of merchant rows
 *
 * A delete the backend rejects with a 409 conflict, meaning the merchant is still referenced by
 * transactions, reopens as a merge instead of failing outright, prompting the user to pick a
 * replacement merchant
 */
export default function MerchantSettingsSection() {
  const refreshMerchants = useRefreshMerchants()
  const { data: categories = [] } = useCategories()
  const deleteMerchant = useDeleteMerchant()
  const mergeMerchant = useMergeMerchant()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const [editingMerchantId, setEditingMerchantId] = useState<string | null>(null)
  const [confirmingDeleteMerchantId, setConfirmingDeleteMerchantId] = useState<string | null>(null)
  const [deletingMerchantId, setDeletingMerchantId] = useState<string | null>(null)
  const [mergeDeleteMerchant, setMergeDeleteMerchant] = useState<Merchant | null>(null)
  // Held apart from the item so the panel keeps its contents while it animates out
  const [isMerchantMergeDeleteOpen, setIsMerchantMergeDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [locallyDeletedMerchantIds, setLocallyDeletedMerchantIds] = useState<string[]>([])
  const merchantList = useMerchantSettingsList(locallyDeletedMerchantIds)

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const options = useMemo(() => categoryOptions(categories), [categories])
  // The rows and everything describing how they are laid out are held together, since a search
  // empties the live list the moment it settles while the rows on screen are still the old ones.
  // A list keeping its rows but losing its scroll cap would grow to the full height of them
  const merchantListSnapshot = useMemo(() => ({
    hasMore: merchantList.hasMoreMerchants,
    merchants: merchantList.visibleMerchants,
    shouldScroll: merchantList.shouldScrollMerchants,
    showListEnd: merchantList.showMerchantListEnd,
    showListMoreIndicator: merchantList.showMerchantListMoreIndicator,
  }), [
    merchantList.hasMoreMerchants,
    merchantList.shouldScrollMerchants,
    merchantList.showMerchantListEnd,
    merchantList.showMerchantListMoreIndicator,
    merchantList.visibleMerchants,
  ])

  const handleDeleteRequest = (merchant: Merchant) => {
    setDeleteError(null)
    setEditingMerchantId(null)
    setConfirmingDeleteMerchantId(merchant.id)
  }

  const handleDelete = async (merchant: Merchant) => {
    setDeleteError(null)
    setDeletingMerchantId(merchant.id)

    const deleteResult = await Promise.allSettled([
      deleteMerchant.mutateAsync(merchant.id),
      waitForMilliseconds(DELETE_SPINNER_MS),
    ])

    if (deleteResult[0].status === 'fulfilled') {
      setLocallyDeletedMerchantIds((ids) => ids.includes(merchant.id) ? ids : [...ids, merchant.id])
      merchantList.setVisibleMerchants((merchants) => merchants.filter((item) => item.id !== merchant.id))
      refreshMerchants()
      setConfirmingDeleteMerchantId(null)
    } else {
      const error = deleteResult[0].reason
      if (error instanceof ApiError && error.status === 409) {
        setConfirmingDeleteMerchantId(null)
        setMergeDeleteMerchant(merchant)
        setIsMerchantMergeDeleteOpen(true)
      } else {
        setDeleteError(error instanceof Error ? error.message : 'Failed to delete merchant.')
      }
    }

    setDeletingMerchantId(null)
  }

  return (
    <section id="merchants" className="scroll-mt-8">
      <SettingsSectionHeader
        title="Merchants"
        description="Manage merchant names and their default categories."
      />

      <SettingsCard>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <GlassSearchField
              value={merchantList.search}
              onValueChange={merchantList.setSearch}
              onSubmit={() => merchantList.setActiveSearch(merchantList.search)}
              placeholder="Search merchants..."
              wrapperClassName="flex-1"
            />
            <button
              type="button"
              className="app-primary-button shrink-0"
              onClick={() => {
                setCreateModalKey((key) => key + 1)
                setShowCreateModal(true)
              }}
            >
              <Plus size={16} aria-hidden />
              Create merchant
            </button>
          </div>

          {deleteError && (
            <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
              {deleteError}
            </p>
          )}

          <LoadingRegion
            loading={merchantList.showInitialMerchantLoading}
            label="Loading merchants"
            transitionKey={merchantList.activeSearch}
            snapshot={merchantListSnapshot}
            overlayClassName={SETTINGS_LIST_LOADING_OVERLAY_CLASS}
            animateLoadingHeight
          >
            {(shownMerchants) => (
              <MerchantSettingsList
                activeSearch={merchantList.activeSearch}
                categoryById={categoryById}
                categoryOptions={options}
                confirmingDeleteMerchantId={confirmingDeleteMerchantId}
                deletingMerchantId={deletingMerchantId}
                editingMerchantId={editingMerchantId}
                hasMoreMerchants={shownMerchants.hasMore}
                listError={merchantList.merchantListError}
                listFailed={merchantList.merchantListFailed}
                merchantListRef={merchantList.merchantListRef}
                shouldScrollMerchants={shownMerchants.shouldScroll}
                showFetchingMoreMerchants={merchantList.showFetchingMoreMerchants}
                showInitialMerchantLoading={merchantList.showInitialMerchantLoading}
                showMerchantListEnd={shownMerchants.showListEnd}
                showMerchantListMoreIndicator={shownMerchants.showListMoreIndicator}
                visibleMerchants={shownMerchants.merchants}
                onDeleteCancel={() => setConfirmingDeleteMerchantId(null)}
                onDeleteConfirm={handleDelete}
                onDeleteRequest={handleDeleteRequest}
                onEdit={(merchant) => setEditingMerchantId(merchant.id)}
                onEditCancel={() => setEditingMerchantId(null)}
                onListMoreClick={merchantList.handleMerchantListMoreClick}
                onListScroll={merchantList.handleMerchantListScroll}
              />
            )}
          </LoadingRegion>
        </div>
      </SettingsCard>

      <CreateMerchantModal
        key={createModalKey}
        open={showCreateModal}
        categoryOptions={options}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => setShowCreateModal(false)}
      />
      {mergeDeleteMerchant && (
        <MergeDeleteMerchantModal
          open={isMerchantMergeDeleteOpen}
          key={mergeDeleteMerchant.id}
          merchant={mergeDeleteMerchant}
          isPending={mergeMerchant.isPending}
          onClose={() => setIsMerchantMergeDeleteOpen(false)}
          onExitComplete={() => setMergeDeleteMerchant(null)}
          onMerge={async (replacementMerchantId) => {
            await mergeMerchant.mutateAsync({
              merchantId: mergeDeleteMerchant.id,
              payload: { replacement_merchant_id: replacementMerchantId },
            })
          }}
        />
      )}
    </section>
  )
}
