import type { UpdateProfilePayload } from '@/api/user'
import type { ActionKeySetting } from '@/utils/actionKey'
import type { DateFormatSetting } from '@/utils/dateFormat'

export interface ProfileFormState {
  first_name: string
  last_name: string
  tz: string
  date_format: DateFormatSetting
  action_key: ActionKeySetting
}

/** The saved profile fields the form edits */
export type SavedProfile = {
  first_name: string
  last_name: string | null
  tz: string
  date_format: DateFormatSetting
  action_key: ActionKeySetting
}

// last_name is stored as "" in the form so the input stays controlled; save
// translates it back to null when clearing the backend column
/**
 * Builds the editable profile form state from the saved user record
 */
export function profileFormFromUser(user: SavedProfile): ProfileFormState {
  return {
    first_name: user.first_name,
    last_name: user.last_name ?? '',
    tz: user.tz,
    date_format: user.date_format,
    action_key: user.action_key,
  }
}

/**
 * Compares the controlled profile form against the saved profile
 */
export function isProfileFormDirty(profileForm: ProfileFormState, user: SavedProfile): boolean {
  return (
    profileForm.first_name !== user.first_name ||
    (profileForm.last_name === '' ? null : profileForm.last_name) !== user.last_name ||
    profileForm.tz !== user.tz ||
    profileForm.date_format !== user.date_format ||
    profileForm.action_key !== user.action_key
  )
}

/**
 * Builds the minimal profile patch while translating blank last names back to null
 */
export function getProfilePatch(profileForm: ProfileFormState, user: SavedProfile): UpdateProfilePayload {
  const patch: UpdateProfilePayload = {}
  if (profileForm.first_name !== user.first_name) patch.first_name = profileForm.first_name.trim()

  const nextLastName = profileForm.last_name === '' ? null : profileForm.last_name
  if (nextLastName !== user.last_name) patch.last_name = nextLastName
  if (profileForm.tz !== user.tz) patch.tz = profileForm.tz
  if (profileForm.date_format !== user.date_format) patch.date_format = profileForm.date_format
  if (profileForm.action_key !== user.action_key) patch.action_key = profileForm.action_key

  return patch
}
