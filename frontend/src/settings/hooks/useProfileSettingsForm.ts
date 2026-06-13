import { useState } from 'react'
import type { User } from '@/api/auth'
import {
  useUpdateProfile,
  type UpdateProfilePayload,
} from '@/api/user'
import { useActionFeedback } from '@/hooks/useActionFeedback'
import { useAuth } from '@/hooks/useAuth'
import { profileFormFromUser, type ProfileFormState } from '@/settings/profileForm'

const emptyProfileForm: ProfileFormState = { first_name: '', last_name: '', tz: '' }

/**
 * Compares the controlled profile form against the backend user shape
 */
function isProfileFormDirty(profileForm: ProfileFormState, user: User | null) {
  if (!user) return false

  return profileForm.first_name !== user.first_name
    || (profileForm.last_name === '' ? null : profileForm.last_name) !== user.last_name
    || profileForm.tz !== user.tz
}

/**
 * Builds the minimal profile patch while translating blank last names back to null
 */
function getProfilePatch(profileForm: ProfileFormState, user: User): UpdateProfilePayload {
  const patch: UpdateProfilePayload = {}
  if (profileForm.first_name !== user.first_name) patch.first_name = profileForm.first_name.trim()

  const nextLastName = profileForm.last_name === '' ? null : profileForm.last_name
  if (nextLastName !== user.last_name) patch.last_name = nextLastName
  if (profileForm.tz !== user.tz) patch.tz = profileForm.tz

  return patch
}

/**
 * Owns profile draft state, validation, mutation feedback, and save/discard actions
 */
export function useProfileSettingsForm() {
  const { user, setUser } = useAuth()
  const updateProfile = useUpdateProfile()
  const profileSaveFeedback = useActionFeedback()
  const [profileOverrides, setProfileOverrides] = useState<Partial<ProfileFormState>>({})
  const profileBase = user ? profileFormFromUser(user) : emptyProfileForm
  const profileForm: ProfileFormState = { ...profileBase, ...profileOverrides }
  const isProfileDirty = isProfileFormDirty(profileForm, user)

  // first_name is required by the backend, so the save button should block blank submissions
  const firstNameValid = profileForm.first_name.trim().length > 0
  const isProfilePending = profileSaveFeedback.isPending || updateProfile.isPending
  const canSaveProfile = isProfileDirty && !isProfilePending && firstNameValid
  const profileSaveError = updateProfile.isError
    ? ((updateProfile.error as Error)?.message ?? 'Failed to save profile.')
    : null

  /**
   * Applies a profile field override without losing untouched backend values
   */
  function setProfileField<K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) {
    setProfileOverrides((overrides) => ({ ...overrides, [key]: value }))
  }

  /**
   * Saves only changed profile fields and clears the local override draft after success
   */
  async function handleSaveProfile() {
    if (!canSaveProfile || !user) return

    try {
      await profileSaveFeedback.run(async () => {
        const updated = await updateProfile.mutateAsync(getProfilePatch(profileForm, user))
        setUser(updated)
        setProfileOverrides({})
      })
    } catch {
      // Mutation errors surface through the pane-level save error text
    }
  }

  /**
   * Discards local profile overrides while keeping the latest backend user as the base
   */
  function handleDiscardProfile() {
    setProfileOverrides({})
  }

  return {
    user,
    profileForm,
    setProfileField,
    firstNameValid,
    isProfileDirty,
    isProfilePending,
    canSaveProfile,
    profileSaveError,
    profileSaveStatus: profileSaveFeedback.status,
    handleSaveProfile,
    handleDiscardProfile,
  }
}
