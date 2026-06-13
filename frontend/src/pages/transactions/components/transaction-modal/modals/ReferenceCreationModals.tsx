import type { Category } from '@/api/categories'
import type { Merchant } from '@/api/merchants'
import type { Tag } from '@/api/tags'
import CreateCategoryModal from '@/components/reference-modals/CreateCategoryModal'
import CreateMerchantModal from '@/components/reference-modals/CreateMerchantModal'
import CreateTagModal from '@/components/reference-modals/CreateTagModal'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import type { TransactionModalKind } from '@/pages/transactions/components/transaction-modal/types'

interface TransactionReferenceCreationModalsProps {
  parentOpen: boolean
  merchantModalKey: number
  merchantOpen: boolean
  merchantInitialName: string
  merchantCategoryOptions: DropdownOption[]
  onCloseMerchant: () => void
  onMerchantCreated: (merchant: Merchant) => void
  categoryModalKey: number
  categoryOpen: boolean
  categoryInitialName: string
  categoryInitialKind: TransactionModalKind
  onCloseCategory: () => void
  onCategoryCreated: (category: Category) => void
  tagModalKey: number
  tagOpen: boolean
  tagInitialName: string
  tagGroupId: string | null
  onCloseTag: () => void
  onTagCreated: (tag: Tag) => void
}

/**
 * Renders nested reference creation modals launched from the transaction modal dropdowns
 */
export default function TransactionReferenceCreationModals({
  parentOpen,
  merchantModalKey,
  merchantOpen,
  merchantInitialName,
  merchantCategoryOptions,
  onCloseMerchant,
  onMerchantCreated,
  categoryModalKey,
  categoryOpen,
  categoryInitialName,
  categoryInitialKind,
  onCloseCategory,
  onCategoryCreated,
  tagModalKey,
  tagOpen,
  tagInitialName,
  tagGroupId,
  onCloseTag,
  onTagCreated,
}: TransactionReferenceCreationModalsProps) {
  return (
    <>
      <CreateMerchantModal
        key={merchantModalKey}
        open={parentOpen && merchantOpen}
        initialName={merchantInitialName}
        variant="secondary"
        categoryOptions={merchantCategoryOptions}
        onClose={onCloseMerchant}
        onCreated={onMerchantCreated}
      />
      <CreateCategoryModal
        key={categoryModalKey}
        open={parentOpen && categoryOpen}
        initialName={categoryInitialName}
        initialKind={categoryInitialKind}
        variant="secondary"
        onClose={onCloseCategory}
        onCreated={onCategoryCreated}
      />
      <CreateTagModal
        key={tagModalKey}
        open={parentOpen && tagOpen}
        initialName={tagInitialName}
        groupId={tagGroupId}
        variant="secondary"
        onClose={onCloseTag}
        onCreated={onTagCreated}
      />
    </>
  )
}
