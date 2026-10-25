import type { ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { DEFAULT_DATE_FORMAT, setDateFormat } from '@/utils/dateFormat'

/**
 * Keeps the shared date formatters on the signed-in user's date format, and on the default while
 * nobody is signed in
 *
 * Written during render rather than in an effect, so every formatter called by the children
 * rendering in this same pass already uses the new setting. Writing the same setting again is
 * harmless, which keeps a repeated render safe
 */
export function DateFormatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  setDateFormat(user?.date_format ?? DEFAULT_DATE_FORMAT)

  return children
}
