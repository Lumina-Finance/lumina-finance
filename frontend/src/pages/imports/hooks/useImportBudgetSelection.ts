import { useMemo } from 'react'

/**
 * Settles which budgets a provider import creates, and the two ways the user changes that
 *
 * The workflow holds the explicit selection itself, since it is one of the answers a failed import
 * is judged against. Until the user makes one, every importable budget is selected
 */
export function useImportBudgetSelection({
  selection,
  setSelection,
  importableKeys,
}: {
  /** The user's explicit selection, null until they make one */
  selection: Set<string> | null
  setSelection: (next: Set<string>) => void
  importableKeys: string[]
}) {
  const selectedKeys = useMemo(() => selection ?? new Set(importableKeys), [importableKeys, selection])

  const toggleBudgetSelection = (key: string) => {
    const next = new Set(selectedKeys)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    setSelection(next)
  }

  const setBudgetsSelected = (keys: string[], selected: boolean) => {
    const next = new Set(selectedKeys)
    for (const key of keys) {
      if (selected) {
        next.add(key)
      } else {
        next.delete(key)
      }
    }
    setSelection(next)
  }

  return { selectedKeys, toggleBudgetSelection, setBudgetsSelected }
}
