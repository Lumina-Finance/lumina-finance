import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import type { Category } from '@/api/categories'
import CategorySettingsRow from '@/pages/settings/components/category-settings-section/list/Row'
import {
  EASE,
  KIND_LABELS,
  type CategoryKind,
} from '@/pages/settings/components/category-settings-section/constants'

/**
 * One collapsible kind of category, with a header giving the kind name and how many it holds,
 * and the rows sliding open beneath it
 *
 * Rows fade in one slightly after the next, and the stagger stops growing partway down so a
 * long group does not leave the last rows waiting
 */
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
    // A block of its own, so the row's outset margins stay inside it and don't change the gap between groups
    <div className="flow-root">
      <button
        type="button"
        className="group/row -mx-2 -my-1.5 flex h-14 w-[calc(100%+1rem)] items-center gap-3 px-2 app-accent-hover rounded-md text-left transition-colors motion-reduce:transition-none"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <ChevronDown
          size={14}
          className={`mt-3 shrink-0 self-start transition-transform duration-150 motion-reduce:transition-none ${expanded ? 'rotate-180' : 'rotate-0'}`}
          style={{ opacity: 0.7 }}
          aria-hidden
        />
        <span className="min-w-0">
          <span className="app-label block group-hover/row:text-[var(--app-accent-nav-text)] group-focus-visible/row:text-[var(--app-accent-nav-text)]">{KIND_LABELS[kind]}</span>
          <span className="block text-xs text-[var(--app-text-subtle)] group-hover/row:text-[var(--app-text-subtle-on-accent)] group-focus-visible/row:text-[var(--app-text-subtle-on-accent)]">
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
