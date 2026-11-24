import { DeletionDate } from '@/components/profile-deletion/DeletionDate'

type DeleteWarningProps = {
  /** The date a waiting deletion runs, or null where it runs at once */
  scheduledFor: string | null
}

/** What the red warning in the Delete profile dialogue says: that the deletion is final, or, where a wait applies, the date it runs and that the user can cancel until then */
export function DeleteWarning({ scheduledFor }: DeleteWarningProps) {
  if (!scheduledFor) return <>This will permanently delete all your data and is irrevocable.</>

  return (
    <>
      Your profile and data will be deleted on <DeletionDate>{scheduledFor}</DeletionDate>. Until then, you can sign in
      and cancel.
    </>
  )
}
