import { Check, Pencil, Trash2, X } from 'lucide-react'
import { motion } from 'motion/react'
import type { Category } from '@/api/categories'
import type { Merchant } from '@/api/merchants'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import MarqueeText from '@/components/display/MarqueeText'
import InlineMerchantEdit from '@/pages/settings/components/merchant-settings-section/editors/InlineEdit'
import {
  MERCHANT_ROW_EXIT,
  MERCHANT_ROW_EXIT_TRANSITION,
} from '@/pages/settings/components/merchant-settings-section/constants'
import {
  categoryName,
  scopeLabel,
} from '@/pages/settings/components/merchant-settings-section/utils'

export default function MerchantRow({
  categoryById,
  categoryOptions,
  confirmingDelete,
  deleting,
  isEditing,
  isLast,
  merchant,
  shouldReduceMotion,
  onDeleteCancel,
  onDeleteConfirm,
  onDeleteRequest,
  onEdit,
  onEditCancel,
}: {
  categoryById: Map<string, Category>
  categoryOptions: DropdownOption[]
  confirmingDelete: boolean
  deleting: boolean
  isEditing: boolean
  isLast: boolean
  merchant: Merchant
  shouldReduceMotion: boolean | null
  onDeleteCancel: () => void
  onDeleteConfirm: (merchant: Merchant) => void | Promise<void>
  onDeleteRequest: (merchant: Merchant) => void
  onEdit: (merchant: Merchant) => void
  onEditCancel: () => void
}) {
  if (isEditing) {
    return (
      <InlineMerchantEdit
        categoryOptions={categoryOptions}
        merchant={merchant}
        isLast={isLast}
        onCancel={onEditCancel}
      />
    )
  }

  return (
    <motion.tr
      layout={!shouldReduceMotion}
      exit={shouldReduceMotion ? { opacity: 0 } : MERCHANT_ROW_EXIT}
      transition={shouldReduceMotion ? { duration: 0.12 } : MERCHANT_ROW_EXIT_TRANSITION}
      className="app-marquee-trigger"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
    >
      <td className="w-px max-w-[14rem] whitespace-nowrap py-3 pl-4 pr-6 align-middle">
        <MarqueeText className="font-medium">{merchant.name}</MarqueeText>
        <p className="truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
          {scopeLabel(merchant)}
        </p>
      </td>
      <td className="min-w-0 py-3 pr-4 align-middle">
        <p className="truncate font-medium">{categoryName(categoryById, merchant.default_category_id)}</p>
      </td>
      <td className="py-3 pr-4 align-middle">
        <div className="flex justify-end gap-1.5">
          {confirmingDelete ? (
            <>
              <button
                type="button"
                className="app-icon-button"
                disabled={deleting}
                onClick={onDeleteCancel}
                aria-label={`Cancel deleting ${merchant.name}`}
                title="Cancel"
              >
                <X size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="app-icon-button"
                disabled={deleting}
                onClick={() => onDeleteConfirm(merchant)}
                aria-label={`Confirm delete ${merchant.name}`}
                title="Confirm delete"
              >
                {deleting ? <div className="app-spinner" aria-label="Deleting" /> : <Check size={16} aria-hidden />}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="app-icon-button"
                onClick={() => onEdit(merchant)}
                aria-label={`Edit ${merchant.name}`}
                title="Edit merchant"
              >
                <Pencil size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="app-icon-button"
                onClick={() => onDeleteRequest(merchant)}
                aria-label={`Delete ${merchant.name}`}
                title="Delete merchant"
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </>
          )}
        </div>
      </td>
    </motion.tr>
  )
}
