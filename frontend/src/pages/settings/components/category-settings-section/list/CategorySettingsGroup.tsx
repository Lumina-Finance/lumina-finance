import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import type { Category } from '@/api/categories'
import CategorySettingsRow from '@/pages/settings/components/category-settings-section/list/CategorySettingsRow'
import {
  EASE,
  KIND_LABELS,
  type CategoryKind,
} from '@/pages/settings/components/category-settings-section/categorySettingsConstants'

export default function CategorySettingsGroup({
  categories,
  confirmingDeleteCategoryId,
  deletingCategoryId,
  editingCategoryId,
  expanded,
  kind,
  onDeleteCancel,
  onDeleteConfirm,
  onDeleteRequest,
  onEdit,
  onEditCancel,
  onToggle,
}: {
  categories: Category[]
  confirmingDeleteCategoryId: string | null
  deletingCategoryId: string | null | undefined
  editingCategoryId: string | null
  expanded: boolean
  kind: CategoryKind
  onDeleteCancel: () => void
  onDeleteConfirm: (category: Category) => void | Promise<void>
  onDeleteRequest: (category: Category) => void
  onEdit: (category: Category) => void
  onEditCancel: () => void
  onToggle: () => void
}) {
  return (
    <div>
      <button
        type="button"
        className="flex h-11 w-full items-center gap-3 text-left"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <ChevronDown
          size={14}
          className={`mt-1.5 shrink-0 self-start transition-transform duration-150 motion-reduce:transition-none ${expanded ? 'rotate-180' : 'rotate-0'}`}
          style={{ opacity: 0.7 }}
          aria-hidden
        />
        <span className="min-w-0">
          <span className="app-label block">{KIND_LABELS[kind]}</span>
          <span className="block text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            {categories.length} {categories.length === 1 ? 'category' : 'categories'}
          </span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: EASE }}
          >
            {categories.map((category, index) => (
              <motion.div
                key={category.id}
                initial={{ opacity: 0, y: -4 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { duration: 0.18, ease: EASE, delay: Math.min(index * 0.025, 0.16) },
                }}
                exit={{ opacity: 0, y: -4, transition: { duration: 0.12, ease: EASE } }}
              >
                <CategorySettingsRow
                  category={category}
                  confirmingDelete={confirmingDeleteCategoryId === category.id}
                  deleting={deletingCategoryId === category.id}
                  isLast={index === categories.length - 1}
                  isEditing={editingCategoryId === category.id}
                  onDeleteCancel={onDeleteCancel}
                  onDeleteConfirm={onDeleteConfirm}
                  onDeleteRequest={onDeleteRequest}
                  onEdit={onEdit}
                  onEditCancel={onEditCancel}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
