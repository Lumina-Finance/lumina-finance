import { Check, Pencil, Trash2, X } from 'lucide-react'
import { motion } from 'motion/react'
import type { Category } from '@/api/categories'
import type { Merchant } from '@/api/merchants'
import type { DropdownOption } from '@/components/Dropdown'
import MarqueeText from '@/components/MarqueeText'
import MobileInlineMerchantEdit from '@/pages/settings/components/merchant-settings-section/MobileInlineMerchantEdit'
import {
  MERCHANT_ROW_EXIT,
  MERCHANT_ROW_EXIT_TRANSITION,
} from '@/pages/settings/components/merchant-settings-section/merchantSettingsConstants'
import {
  categoryName,
  scopeLabel,
} from '@/pages/settings/components/merchant-settings-section/merchantSettingsUtils'

export default function MobileMerchantRow({
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
      <MobileInlineMerchantEdit
        categoryOptions={categoryOptions}
        merchant={merchant}
        isLast={isLast}
        onCancel={onEditCancel}
      />
    )
  }

  return (
    <motion.div
      layout={!shouldReduceMotion}
      exit={shouldReduceMotion ? { opacity: 0 } : MERCHANT_ROW_EXIT}
      transition={shouldReduceMotion ? { duration: 0.12 } : MERCHANT_ROW_EXIT_TRANSITION}
      className="app-marquee-trigger py-3"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2">
        <div className="min-w-0">
          <MarqueeText active className="font-medium">{merchant.name}</MarqueeText>
          <p className="truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
            {scopeLabel(merchant)}
          </p>
        </div>
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
        <div className="col-span-2 min-w-0">
          <span
            className="inline-flex max-w-full rounded-md px-2.5 py-1 text-sm font-medium"
            style={{
              background: 'var(--app-input-bg)',
              color: 'var(--app-text-muted)',
              border: '1px solid var(--app-input-border)',
            }}
          >
            <span className="truncate">{categoryName(categoryById, merchant.default_category_id)}</span>
          </span>
        </div>
      </div>
    </motion.div>
  )
}
