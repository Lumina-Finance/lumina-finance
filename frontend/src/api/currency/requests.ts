import { API_BASE } from '@/api/config';
import type { Currency } from '@/api/currency/types';

// How long the app itself waits, since no screen can render an amount before this list arrives.
// App.tsx holds everything behind its loading screen until this settles one way or the other, and
// shows the recovery screen when it fails. The bound lives here rather than in a timer beside that
// loading screen, where it would have to be reset every time a component remounted
//
// The sign-up and provider-callback pages read the list outside that gate, to fill a currency picker
// rather than to format an amount, and this is also what stops those waiting on it forever
const CURRENCY_REQUEST_TIMEOUT_MS = 5_000;

/**
 * Fetches static ISO currency metadata used by money inputs and displays
 *
 * @throws Error when the response is not ok, and a TimeoutError when the request outlives the timeout
 */
export async function fetchCurrencies(): Promise<Currency[]> {
  const res = await fetch(`${API_BASE}/currencies`, {
    signal: AbortSignal.timeout(CURRENCY_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Failed to load currencies (${res.status})`);
  }
  return res.json();
}
