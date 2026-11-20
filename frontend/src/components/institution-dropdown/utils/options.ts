import type { Institution } from '@/api/institutions'
import type { DropdownOption } from '@/components/dropdown/Dropdown'

/** The blank entry that leads the list, standing for an account with no institution */
export const NO_INSTITUTION_OPTION: DropdownOption = { value: '', label: 'None' }

/**
 * Builds the options for the institutions a picker holds, with the "None" entry first
 *
 * While the user is searching, the list is what the search found, and a "None" entry among the
 * matches would answer a question nobody asked
 *
 * @param institutions - The pages loaded so far, already in the server's name order
 * @param searching - Whether the user has typed search text
 */
export function buildInstitutionOptions(institutions: Institution[], searching: boolean): DropdownOption[] {
  const options = institutions.map((institution) => ({ value: institution.id, label: institution.name }))
  return searching ? options : [NO_INSTITUTION_OPTION, ...options]
}

/**
 * Finds the institution a picker's value names, wherever the caller has it: on a loaded page, as
 * the institution the caller already holds, or as the one read on its own
 *
 * The first two are tried before the third so a selection that is already known costs no request
 *
 * @param value - The chosen institution's ID, or an empty string for none
 * @param loaded - The institutions on the pages loaded so far
 * @param known - The institution the caller holds for this value, such as the one an account carries
 * @param fetched - The institution read on its own, once it has arrived
 */
export function findSelectedInstitution(
  value: string,
  loaded: Institution[],
  known: Institution | null | undefined,
  fetched: Institution | undefined,
): Institution | undefined {
  if (value === '') return undefined
  return (
    loaded.find((institution) => institution.id === value) ??
    (known?.id === value ? known : undefined) ??
    (fetched?.id === value ? fetched : undefined)
  )
}

/**
 * Builds the option the trigger shows for the chosen value. It is not always among the options,
 * because the chosen institution may sit beyond the pages loaded or be left out of a search's matches
 */
export function buildSelectedInstitutionOption(
  value: string,
  institution: Institution | undefined,
): DropdownOption | undefined {
  if (value === '') return NO_INSTITUTION_OPTION
  return institution ? { value: institution.id, label: institution.name } : undefined
}
