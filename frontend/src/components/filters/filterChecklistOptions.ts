import type { OptionItem } from '@/components/filters/OptionList'

/**
 * Keeps the options whose label, or type or institution when they carry details, contain the search
 * text, ignoring case and surrounding spaces
 */
export function filterChecklistOptions(options: OptionItem[], search: string): OptionItem[] {
  const query = search.trim().toLowerCase()
  if (!query) return options
  return options.filter((option) =>
    [option.label, option.details?.type, option.details?.institution].some((text) => text?.toLowerCase().includes(query)),
  )
}
