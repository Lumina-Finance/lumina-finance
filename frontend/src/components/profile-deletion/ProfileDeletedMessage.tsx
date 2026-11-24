import { DeletionDate } from '@/components/profile-deletion/DeletionDate'

type ProfileDeletedMessageProps = {
  /** The date a waiting deletion runs, already written in the date format the user had, or null when the profile is gone */
  scheduledFor: string | null
}

/** What the sign-in screen says about a deletion the user just confirmed */
export function ProfileDeletedMessage({ scheduledFor }: ProfileDeletedMessageProps) {
  if (!scheduledFor) return <>Your profile and data were deleted.</>

  return (
    <>
      Your profile will be deleted on <DeletionDate>{scheduledFor}</DeletionDate>. Please sign in and cancel before
      then.
    </>
  )
}
