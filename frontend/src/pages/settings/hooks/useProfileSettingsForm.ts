import { useState } from 'react'
import { useUpdateProfile } from '@/api/user'
import { useActionFeedback } from '@/hooks/useActionFeedback'
import { useAuth } from '@/hooks/useAuth'
import {
  getProfilePatch,
  isProfileFormDirty,
  profileFormFromUser,
  type ProfileFormState,
} from '@/pages/settings/profileForm'
import { getProfileSaveBlockedReason } from '@/pages/settings/utils/profileForm'
import { DEFAULT_DATE_FORMAT } from '@/utils/dateFormat'

const emptyProfileForm: ProfileFormState = { first_name: '', last_name: '', tz: '', date_format: DEFAULT_DATE_FORMAT }

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
  const isProfileDirty = user ? isProfileFormDirty(profileForm, user) : false

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

    // A new date format remounts the routed pages, which would drop this save's success state, so that
    // change reaches the user only once the success state has shown
    const deferred: { apply?: () => void } = {}

    try {
      await profileSaveFeedback.run(async () => {
        const updated = await updateProfile.mutateAsync(getProfilePatch(profileForm, user))
        if (updated.date_format === user.date_format) {
          setUser(updated)
          setProfileOverrides({})
          return
        }

        // Fields stay editable while the success state shows, so only the drafts left as they were saved go
        const sent = profileForm
        deferred.apply = () => {
          setUser(updated)
          setProfileOverrides((overrides) =>
            Object.fromEntries(Object.entries(overrides).filter(([key, value]) => value !== sent[key as keyof ProfileFormState])),
          )
        }
      })
      deferred.apply?.()
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
    profileSaveBlockedReason: getProfileSaveBlockedReason(firstNameValid),
    profileSaveError,
    profileSaveStatus: profileSaveFeedback.status,
    handleSaveProfile,
    handleDiscardProfile,
  }
}
