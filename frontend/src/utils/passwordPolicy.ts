export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

interface PasswordRule {
  label: string
  test: (value: string) => boolean
}

/**
 * Password rules that mirror the backend validate_password_strength in
 * backend/app/schemas/auth.py, kept in lockstep so the client never accepts a
 * password the change-password endpoint would reject
 */
export const NEW_PASSWORD_RULES: PasswordRule[] = [
  {
    label: `${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`,
    test: (value) => value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH,
  },
  { label: 'At least one uppercase letter', test: (value) => /[A-Z]/.test(value) },
  { label: 'At least one number', test: (value) => /\d/.test(value) },
  { label: 'At least one special character', test: (value) => /[^A-Za-z0-9]/.test(value) },
]

/**
 * Returns whether a new password satisfies every policy rule
 */
export function isNewPasswordValid(value: string): boolean {
  return NEW_PASSWORD_RULES.every((rule) => rule.test(value))
}
