import { useEffect, useRef } from 'react'
import LoadingScreen from '@/components/loading/Screen'
import { runNativePasskeyCeremony } from '@/utils/nativePasskey'

// The address the app's sign-in sheet closes on, carrying the prompt's result back to the app
const NATIVE_CALLBACK = 'luminafinance://passkey/callback'

/**
 * Runs one passkey prompt for a native app, which can't show one itself for a server whose domain it
 * couldn't declare in advance. The app opens this page in its sign-in sheet with the server's options
 * in the fragment, which never reaches a server, and keeps every other step of the sign-in or setup.
 * The credential, or the message the web would show for a failure, goes back in the sheet's address
 */
export default function NativePasskeyPage() {
  // Strict mode runs effects twice, and the prompt must open only once
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const fragment = new URLSearchParams(window.location.hash.slice(1))
    window.history.replaceState(null, '', window.location.pathname)
    void runNativePasskeyCeremony(fragment.get('ceremony'), fragment.get('options')).then((result) => {
      window.location.replace(`${NATIVE_CALLBACK}?${new URLSearchParams(result)}`)
    })
  }, [])

  return <LoadingScreen />
}
