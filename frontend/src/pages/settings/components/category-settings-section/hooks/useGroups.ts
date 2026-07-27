import { useMemo, useState } from 'react'
import type { Category } from '@/api/categories'
import {
  KIND_ORDER,
  type CategoryKind,
} from '@/pages/settings/components/category-settings-section/constants'
import { displayKind } from '@/pages/settings/components/category-settings-section/utils'

/**
 * Splits the categories into their kinds in a fixed display order, narrows each kind by the
 * search text, and tracks which kinds the user has opened
 *
 * Every kind is returned even when it holds nothing after filtering, so the caller decides
 * whether an empty kind is hidden or shown as empty
 */
export function useCategorySettingsGroups(categories: Category[], search: string) {
  const [expandedKinds, setExpandedKinds] = useState<Set<CategoryKind>>(() => new Set())

  const groupedCategories = useMemo(() => {
    const query = search.trim().toLowerCase()
    return KIND_ORDER.map((kind) => {
      const items = categories
        .filter((category) => displayKind(category) === kind)
        .filter((category) => !query || category.name.toLowerCase().includes(query))
      return { kind, items }
    })
  }, [categories, search])

  const hasMatches = groupedCategories.some((group) => group.items.length > 0)

  const toggleKind = (kind: CategoryKind) => {
    setExpandedKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const expandKind = (kind: CategoryKind) => {
    setExpandedKinds((current) => new Set(current).add(kind))
  }

  return {
    expandedKinds,
    expandKind,
    groupedCategories,
    hasMatches,
    toggleKind,
  }
}
