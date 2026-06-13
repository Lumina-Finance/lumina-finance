import { Check, Lock, Pencil, Trash2, X } from 'lucide-react'
import type { Category } from '@/api/categories'
import InlineCategoryEdit from '@/pages/settings/components/category-settings-section/InlineCategoryEdit'
import { displayEmoji } from '@/pages/settings/components/category-settings-section/categorySettingsUtils'

export default function CategorySettingsRow({
  category,
  confirmingDelete,
  deleting,
  isLast,
  isEditing,
  onDeleteCancel,
  onDeleteConfirm,
  onDeleteRequest,
  onEdit,
  onEditCancel,
}: {
  category: Category
  confirmingDelete: boolean
  deleting: boolean
  isLast: boolean
  isEditing: boolean
  onDeleteCancel: () => void
  onDeleteConfirm: (category: Category) => void | Promise<void>
  onDeleteRequest: (category: Category) => void
  onEdit: (category: Category) => void
  onEditCancel: () => void
}) {
  const systemCategory = category.is_system
  const scopeLabel = category.is_system
    ? 'System category'
    : category.group_id
      ? 'Group category'
      : 'Personal category'
  if (isEditing) {
    return (
      <InlineCategoryEdit
        category={category}
        isLast={isLast}
        onCancel={onEditCancel}
      />
    )
  }

  return (
    <div
      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center p-1 text-xl leading-none"
          aria-hidden
        >
          <span className="translate-x-px" aria-hidden>
            {displayEmoji(category)}
          </span>
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="line-clamp-2 font-medium leading-tight min-[750px]:truncate min-[750px]:leading-normal">
              {category.name}
            </p>
          </div>
          <p className="truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
            {scopeLabel}
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-1.5">
        {systemCategory ? (
          <span
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium"
            style={{
              color: 'var(--app-text-muted)',
              background: 'var(--app-input-bg)',
              border: '1px solid var(--app-input-border)',
            }}
          >
            <Lock size={13} aria-hidden />
            System
          </span>
        ) : (
          <>
            {confirmingDelete ? (
              <>
                <button
                  type="button"
                  className="app-icon-button"
                  disabled={deleting}
                  onClick={onDeleteCancel}
                  aria-label={`Cancel deleting ${category.name}`}
                  title="Cancel"
                >
                  <X size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="app-icon-button"
                  disabled={deleting}
                  onClick={() => onDeleteConfirm(category)}
                  aria-label={`Confirm delete ${category.name}`}
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
                  onClick={() => onEdit(category)}
                  aria-label={`Edit ${category.name}`}
                  title="Edit category"
                >
                  <Pencil size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="app-icon-button"
                  onClick={() => onDeleteRequest(category)}
                  aria-label={`Delete ${category.name}`}
                  title="Delete category"
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
