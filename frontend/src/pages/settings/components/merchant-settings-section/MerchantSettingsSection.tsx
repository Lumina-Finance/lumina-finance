import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import { Plus, Search } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { useCategories } from '@/api/categories'
import {
  useDeleteMerchant,
  useMergeMerchant,
  type Merchant,
} from '@/api/merchants'
import { merchantKeys } from '@/api/cache/queryKeys'
import CreateMerchantModal from '@/components/CreateMerchantModal'
import MerchantSettingsList from '@/pages/settings/components/merchant-settings-section/MerchantSettingsList'
import MergeDeleteMerchantModal from '@/pages/settings/components/merchant-settings-section/MergeDeleteMerchantModal'
import { DELETE_SPINNER_MS } from '@/pages/settings/components/merchant-settings-section/merchantSettingsConstants'
import { categoryOptions } from '@/pages/settings/components/merchant-settings-section/merchantSettingsUtils'
import { useMerchantSettingsList } from '@/pages/settings/components/merchant-settings-section/hooks/useMerchantSettingsList'
import SettingsSectionHeader from '@/pages/settings/components/SettingsSectionHeader'
import SettingsCard from '@/pages/settings/components/SettingsCard'
import { waitForMilliseconds } from '@/utils/timing'

export default function MerchantSettingsSection() {
  const queryClient = useQueryClient()
  const { data: categories = [] } = useCategories()
  const deleteMerchant = useDeleteMerchant()
  const mergeMerchant = useMergeMerchant()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const [editingMerchantId, setEditingMerchantId] = useState<string | null>(null)
  const [confirmingDeleteMerchantId, setConfirmingDeleteMerchantId] = useState<string | null>(null)
  const [deletingMerchantId, setDeletingMerchantId] = useState<string | null>(null)
  const [mergeDeleteMerchant, setMergeDeleteMerchant] = useState<Merchant | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [locallyDeletedMerchantIds, setLocallyDeletedMerchantIds] = useState<string[]>([])
  const merchantList = useMerchantSettingsList(locallyDeletedMerchantIds)

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const options = useMemo(() => categoryOptions(categories), [categories])

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
      queryClient.invalidateQueries({ queryKey: merchantKeys.all, exact: false })
      setConfirmingDeleteMerchantId(null)
    } else {
      const error = deleteResult[0].reason
      if (error instanceof ApiError && error.status === 409) {
        setConfirmingDeleteMerchantId(null)
        setMergeDeleteMerchant(merchant)
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
            <div className="relative min-w-0 flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--app-text-subtle)' }}
                aria-hidden
              />
              <input
                className="app-input pl-9"
                value={merchantList.search}
                onChange={(event) => {
                  merchantList.setSearch(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  merchantList.setActiveSearch(merchantList.search)
                }}
                placeholder="Search merchants..."
              />
            </div>
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

          <MerchantSettingsList
            activeSearch={merchantList.activeSearch}
            categoryById={categoryById}
            categoryOptions={options}
            confirmingDeleteMerchantId={confirmingDeleteMerchantId}
            deletingMerchantId={deletingMerchantId}
            editingMerchantId={editingMerchantId}
            hasMoreMerchants={merchantList.hasMoreMerchants}
            merchantListRef={merchantList.merchantListRef}
            shouldScrollMerchants={merchantList.shouldScrollMerchants}
            showFetchingMoreMerchants={merchantList.showFetchingMoreMerchants}
            showInitialMerchantLoading={merchantList.showInitialMerchantLoading}
            showMerchantListEnd={merchantList.showMerchantListEnd}
            showMerchantListMoreIndicator={merchantList.showMerchantListMoreIndicator}
            visibleMerchants={merchantList.visibleMerchants}
            onDeleteCancel={() => setConfirmingDeleteMerchantId(null)}
            onDeleteConfirm={handleDelete}
            onDeleteRequest={handleDeleteRequest}
            onEdit={(merchant) => setEditingMerchantId(merchant.id)}
            onEditCancel={() => setEditingMerchantId(null)}
            onListMoreClick={merchantList.handleMerchantListMoreClick}
            onListScroll={merchantList.handleMerchantListScroll}
          />
        </div>
      </SettingsCard>

      <CreateMerchantModal
        key={createModalKey}
        open={showCreateModal}
        categoryOptions={options}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => setShowCreateModal(false)}
      />
      <AnimatePresence>
        {mergeDeleteMerchant && (
          <MergeDeleteMerchantModal
            key={mergeDeleteMerchant.id}
            merchant={mergeDeleteMerchant}
            isPending={mergeMerchant.isPending}
            onClose={() => setMergeDeleteMerchant(null)}
            onMerge={async (replacementMerchantId) => {
              await mergeMerchant.mutateAsync({
                merchantId: mergeDeleteMerchant.id,
                payload: { replacement_merchant_id: replacementMerchantId },
              })
            }}
          />
        )}
      </AnimatePresence>
    </section>
  )
}
