import { useEffect } from 'react'
import { useQueryClient, focusManager, type QueryKey } from '@tanstack/react-query'

// Refetch the given query keys whenever the window/tab regains focus. Decouples
// focus refetching from observer subscription, so each page only refreshes its
// primary data — not shared lookups it happens to consume.
export function useFocusRefetch(queryKeys: QueryKey[]): void {
  const queryClient = useQueryClient()
  // Stable serialized form lets the effect deps compare structurally.
  const keysJson = JSON.stringify(queryKeys)
  useEffect(() => {
    const keys: QueryKey[] = JSON.parse(keysJson)
    return focusManager.subscribe((focused) => {
      if (!focused) return
      for (const key of keys) queryClient.invalidateQueries({ queryKey: key })
    })
  }, [queryClient, keysJson])
}
