/**
 * Tests the options and selection the institution dropdown builds, so a chosen institution keeps its
 * name and logo wherever it sits in the shared table and a search never offers "None" as a match
 */
import { describe, expect, it } from 'vitest'
import type { Institution } from '@/api/institutions'
import {
  buildInstitutionOptions,
  buildSelectedInstitutionOption,
  findSelectedInstitution,
  NO_INSTITUTION_OPTION,
} from '@/components/institution-dropdown/utils/options'

function createInstitution(id: string, name: string): Institution {
  return { id, status: 'active', name, country_code: 'CA', website: '', logo_url: null }
}

const alpha = createInstitution('alpha', 'Alpha Bank')
const beta = createInstitution('beta', 'Beta Bank')

describe('buildInstitutionOptions', () => {
  it('leads with None, then the institutions in the order the server returned them', () => {
    expect(buildInstitutionOptions([alpha, beta], false)).toEqual([
      NO_INSTITUTION_OPTION,
      { value: 'alpha', label: 'Alpha Bank' },
      { value: 'beta', label: 'Beta Bank' },
    ])
  })

  it('leaves None out while the user is searching, since it matches nothing they typed', () => {
    expect(buildInstitutionOptions([beta], true)).toEqual([{ value: 'beta', label: 'Beta Bank' }])
  })
})

describe('findSelectedInstitution', () => {
  it('prefers a loaded page, then the institution the caller holds, then the one read on its own', () => {
    const loadedCopy = createInstitution('alpha', 'Loaded')
    const knownCopy = createInstitution('alpha', 'Known')
    const fetchedCopy = createInstitution('alpha', 'Fetched')

    expect(findSelectedInstitution('alpha', [loadedCopy], knownCopy, fetchedCopy)).toBe(loadedCopy)
    expect(findSelectedInstitution('alpha', [], knownCopy, fetchedCopy)).toBe(knownCopy)
    expect(findSelectedInstitution('alpha', [], null, fetchedCopy)).toBe(fetchedCopy)
  })

  it('finds a selection that sits beyond the first page by what the caller holds', () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => createInstitution(`bank-${index}`, `Bank ${index}`))
    const accountsInstitution = createInstitution('zeta', 'Zeta Bank')

    expect(findSelectedInstitution('zeta', firstPage, accountsInstitution, undefined)).toBe(accountsInstitution)
  })

  it('ignores a held institution that is a different one from the value', () => {
    expect(findSelectedInstitution('alpha', [], beta, undefined)).toBeUndefined()
    expect(findSelectedInstitution('alpha', [], null, beta)).toBeUndefined()
  })

  it('finds nothing for the blank value, which stands for no institution', () => {
    expect(findSelectedInstitution('', [alpha], alpha, alpha)).toBeUndefined()
  })
})

describe('buildSelectedInstitutionOption', () => {
  it('names the chosen institution', () => {
    expect(buildSelectedInstitutionOption('alpha', alpha)).toEqual({ value: 'alpha', label: 'Alpha Bank' })
  })

  it('shows None for the blank value', () => {
    expect(buildSelectedInstitutionOption('', undefined)).toEqual(NO_INSTITUTION_OPTION)
  })

  it('offers nothing while the chosen institution has not arrived, so the trigger shows no wrong name', () => {
    expect(buildSelectedInstitutionOption('alpha', undefined)).toBeUndefined()
  })
})
