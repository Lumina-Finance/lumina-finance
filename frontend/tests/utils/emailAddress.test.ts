import { expect, it } from 'vitest'
import { getEmailAddressError } from '@/utils/emailAddress'

it('accepts an address shaped like one and names the problem with one that is not', () => {
  expect(getEmailAddressError('person@example.com')).toBeUndefined()
  expect(getEmailAddressError('')).toBe('Email is required')
  expect(getEmailAddressError('person@example')).toBe('Enter a valid email address')
  expect(getEmailAddressError('per son@example.com')).toBe('Enter a valid email address')
})
