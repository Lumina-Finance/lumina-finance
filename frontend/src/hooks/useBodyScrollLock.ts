import { useEffect } from 'react'

let lockCount = 0
let previousOverflow = ''

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return undefined

    if (lockCount === 0) {
      previousOverflow = document.body.style.overflow
      document.body.classList.add('app-body-scroll-locked')
      document.body.style.overflow = 'hidden'
    }

    lockCount += 1

    return () => {
      lockCount -= 1
      if (lockCount > 0) return

      document.body.style.overflow = previousOverflow
      document.body.classList.remove('app-body-scroll-locked')
      previousOverflow = ''
    }
  }, [locked])
}
