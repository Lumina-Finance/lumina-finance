import { isPasskeyCeremonyCancelled } from '@/utils/passkeyErrors'
import { delayToMinimum } from '@/utils/timing'

/** Holds passkey feedback through fast results while leaving native prompt cancellation immediate */
export async function withPasskeyFeedbackMinimum<T>(action: () => Promise<T>): Promise<T> {
  const start = Date.now()
  let cancelled = false

  try {
    return await action()
  } catch (error) {
    cancelled = isPasskeyCeremonyCancelled(error)
    throw error
  } finally {
    if (!cancelled) await delayToMinimum(start)
  }
}
