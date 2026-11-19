/**
 * Guards the institution form's website field, whose address every user's accounts page loads a logo from
 * once saved, so an address that is not https or is too long is refused on the field before it is sent
 */
import { describe, expect, it } from 'vitest'
import {
  INSTITUTION_WEBSITE_NOT_HTTPS_MESSAGE,
  INSTITUTION_WEBSITE_TOO_LONG_MESSAGE,
  validateInstitutionForm,
} from '@/components/reference-modals/institutionForm'

const VALID_FORM = { name: 'TD', country_code: 'CA', website: 'https://www.td.com' }
const ORIGIN = 'https://example.com/'

describe('the institution website field', () => {
  it.each([
    { name: 'an https address', website: 'https://www.td.com', problem: undefined },
    {
      name: 'an https address in capitals with spaces around it',
      website: '  HTTPS://WWW.TD.COM  ',
      problem: undefined,
    },
    {
      name: 'an address of exactly 2,048 characters',
      website: ORIGIN + 'a'.repeat(2048 - ORIGIN.length),
      problem: undefined,
    },
    { name: 'an http address', website: 'http://www.td.com', problem: INSTITUTION_WEBSITE_NOT_HTTPS_MESSAGE },
    { name: 'a script', website: 'javascript:alert(1)', problem: INSTITUTION_WEBSITE_NOT_HTTPS_MESSAGE },
    { name: 'an address with no scheme', website: 'www.td.com', problem: INSTITUTION_WEBSITE_NOT_HTTPS_MESSAGE },
    {
      name: 'an address of 3,000 characters',
      website: ORIGIN + 'a'.repeat(3000),
      problem: INSTITUTION_WEBSITE_TOO_LONG_MESSAGE,
    },
    {
      name: 'an address one character past the limit',
      website: ORIGIN + 'a'.repeat(2049 - ORIGIN.length),
      problem: INSTITUTION_WEBSITE_TOO_LONG_MESSAGE,
    },
    { name: 'a blank address', website: '   ', problem: 'Website is required' },
  ])('gives the right message for $name', ({ website, problem }) => {
    expect(validateInstitutionForm({ ...VALID_FORM, website }).website).toBe(problem)
  })

  it('counts an address in characters, as the backend does, not in the units an emoji takes', () => {
    const emojiAddress = ORIGIN + '😀'.repeat(2048 - ORIGIN.length)

    expect(validateInstitutionForm({ ...VALID_FORM, website: emojiAddress }).website).toBeUndefined()
  })
})
