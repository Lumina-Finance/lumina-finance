import type { AuthenticationResponseJSON } from '@simplewebauthn/browser'
import type { User } from '@/api/auth/types'
import type { FxStatus } from '@/api/shared/fx'
import type { StepUpPayload } from '@/api/two-factor/types'
import type { DateFormatSetting } from '@/utils/dateFormat'

/**
 * Editable profile fields for the current user
 */
export interface UpdateProfilePayload {
  first_name?: string
  last_name?: string | null
  tz?: string
  date_format?: DateFormatSetting
}

/**
 * Current and replacement passwords for a password change, with the second factor required when one
 * is active
 */
export interface ChangePasswordPayload {
  current_password: string
  new_password: string
  /** Current TOTP code, used when stepping up by authenticator, recovery codes are not accepted */
  code?: string
  /** Passkey assertion, used when stepping up by passkey, taking priority over a code */
  passkey?: AuthenticationResponseJSON
}

/**
 * The address an account asks to move to, with the step-up an account that has a password sends. A
 * passwordless account omits the step-up and relies on the proof cookie a fresh provider reauth armed
 */
export interface RequestEmailChangePayload {
  new_email: string
  step_up?: StepUpPayload
}

/**
 * What GET /me answers. Sign-in and renewal responses carry a User without the sentence, so the
 * sentence is read only through the profile query and never held on the signed-in user
 */
export type UserProfile = User & {
  /** The sentence the server gives when it refuses records in a currency other than base_currency, null while it allows them */
  foreign_currencies_refusal: string | null
}

export interface CacheScopeStatus {
  changed_at: string | null
  last_change_from_current_session: boolean
}

export interface CacheStatus {
  changed_at: string | null
  current_date: string
  calculation_date_token: string
  /** A short digest of the sentence the server gives when it refuses other currencies, null while it allows them */
  foreign_currencies_token: string | null
  next_calculation_boundary_at: string
  personal: CacheScopeStatus
  groups: Record<string, CacheScopeStatus>
  /** When data every user shares last changed, null until the first change */
  shared_changed_at: string | null
  /** The release the server runs */
  server_version: string
}

export interface RatesStatus {
  /** Digest of the recent exchange rates behind the user's converted figures, null when they can't be read now */
  digest: string | null
}

/** A feature the server grants a user or not, as the server names it */
export type GrantableFeature = 'bank_sync' | 'insights' | 'foreign_currencies'

/** The features the signed-in user is granted */
export type FeatureGrants = {
  features: GrantableFeature[]
}

export interface RunwayThresholdsResponse {
  risky_below_months: number
  healthy_at_months: number
}

// Frontend-normalized runway thresholds, in months, snapped to half-month steps with the healthy
// threshold always kept at least two months above the risky one
export type RunwayThresholds = {
  riskyBelowMonths: number
  healthyAtMonths: number
}

export interface RunwaySettingsResponse {
  account_ids: string[]
  archived_account_ids: string[]
  thresholds: RunwayThresholdsResponse
}

export interface RunwaySettingsPayload {
  account_ids: string[]
  thresholds: RunwayThresholdsResponse
}

export interface RunwaySettings {
  accountIds: string[]
  archivedAccountIds: string[]
  thresholds: RunwayThresholds
}

export interface RunwaySettingsUpdate {
  accountIds: string[]
  thresholds: RunwayThresholds
}

export interface RunwayAccountBalance {
  account_id: string
  balance: number
}

export interface RunwayResultResponse {
  months: number | null
  reason: 'no_accounts' | 'insufficient_history' | null
  avg_monthly_expense: number
  months_covered: number
  liquid_balance: number
  account_balances: RunwayAccountBalance[]
  thresholds: RunwayThresholdsResponse
  fx_status: FxStatus

  // Whether expenses in another currency were left out of the history because converting them is refused
  expenses_withheld?: boolean
}

/**
 * Frontend runway result with normalized threshold field names
 */
export interface RunwayResult {
  months: number | null
  reason: 'no_accounts' | 'insufficient_history' | null
  avg_monthly_expense: number
  months_covered: number
  liquid_balance: number
  account_balances: RunwayAccountBalance[]
  thresholds: RunwayThresholds
  fx_status: FxStatus
  expenses_withheld?: boolean
}
