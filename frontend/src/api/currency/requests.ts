import { API_BASE } from '@/api/config';
import type { Currency } from '@/api/currency/types';

// A request left hanging is worse here than one that fails, since every form waiting on the list shows
// that it is still loading and would say so forever. Aborting turns that into a failure the forms can
// report and the user can act on
//
// It is also how long the app itself waits: no screen can render an amount before this list arrives,
// so App.tsx holds everything behind its loading screen until this settles one way or the other, and
// shows the recovery screen when it fails. That is why the bound lives here rather than in a timer
// beside the loading screen, where it would have to be reset every time a component remounted
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
