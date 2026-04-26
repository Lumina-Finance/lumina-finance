import { useEffect } from 'react'
import { useQueryClient, focusManager } from '@tanstack/react-query'
import type { FocusRefetchTarget } from '@/api/queryKeys'

// Refetch the given query keys whenever the window/tab regains focus. Decouples
// focus refetching from observer subscription, so each page only refreshes its
// primary data — not shared lookups it happens to consume.
export function useFocusRefetch(targets: FocusRefetchTarget[]): void {
  const queryClient = useQueryClient()
  // Stable serialized form lets the effect deps compare structurally.
  const targetsJson = JSON.stringify(targets)
  useEffect(() => {
    const parsedTargets: FocusRefetchTarget[] = JSON.parse(targetsJson)
    return focusManager.subscribe((focused) => {
      if (!focused) return
      for (const target of parsedTargets) {
        if ('queryKey' in target) {
          queryClient.invalidateQueries({
            queryKey: target.queryKey,
            exact: target.exact ?? true,
          })
        } else {
          queryClient.invalidateQueries({ queryKey: target, exact: true })
        }
      }
    })
  }, [queryClient, targetsJson])
}
