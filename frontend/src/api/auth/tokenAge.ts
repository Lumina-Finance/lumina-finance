/**
 * Works out when an access token stops being accepted, as a time on this device's clock
 *
 * The token states its lifetime as its issue and expiry times on the server's clock. Counting that
 * lifetime from when the browser received the token keeps a device clock that runs fast or slow from
 * renewing before every request, or never
 *
 * @param token - The encoded access token
 * @param receivedAt - When the browser received it, in milliseconds on this device's clock
 * @returns When it expires on this device's clock, or null when the token's times can't be read
 */
export function getAccessTokenExpiresAt(token: string, receivedAt: number): number | null {
  const payload = token.split('.')[1];
  if (token.split('.').length !== 3 || !payload) return null;

  try {
    const base64 = payload.replaceAll('-', '+').replaceAll('_', '/');
    const claims: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    if (typeof claims !== 'object' || claims === null) return null;
    const { iat, exp } = claims as { iat?: unknown; exp?: unknown };
    if (typeof iat !== 'number' || typeof exp !== 'number') return null;
    return receivedAt + (exp - iat) * 1000;
  } catch {
    return null;
  }
}
