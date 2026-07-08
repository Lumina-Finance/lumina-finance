import { useContext } from 'react'
import { NavCollapseContext, type NavCollapseValue } from '@/contexts/NavCollapseContext'

/**
 * Exposes the pinned navigation expand state and its toggle
 */
export function useNavCollapse(): NavCollapseValue {
  const context = useContext(NavCollapseContext)
  if (!context) throw new Error('useNavCollapse must be used within a NavCollapseProvider')
  return context
}
