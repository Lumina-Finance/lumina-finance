/**
 * Shared shape for a selectable filter option, used by the transaction and account filter panels to
 * back their multi-select checklists and active-filter chips
 */
export interface OptionItem {
  value: string
  label: string
  group?: string
  icon?: string | null
  // Logo or image source shown in place of the text icon, used by the institution filter options
  imageUrl?: string | null
  // A checklist whose options carry details shows them in aligned columns beside the label, and
  // searches them too. The filter panels leave it out
  details?: { type: string; institution: string | null }
}
