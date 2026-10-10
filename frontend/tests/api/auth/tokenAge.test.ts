/**
 * Covers when the browser treats its access token as about to expire
 *
 * These tests catch regressions where a token's lifetime is misread, so an aged-out tab sends every
 * request with a refused sign-in, or a fresh one renews before each request
 */
import { describe, expect, it } from 'vitest';
import { getAccessTokenExpiresAt } from '@/api/auth/tokenAge';

/** Encodes a JSON value the way a JWT segment is, base64url without padding */
function encodeSegment(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Builds an unsigned token whose payload carries the given claims */
function buildToken(claims: Record<string, unknown>): string {
  return `${encodeSegment({ alg: 'RS256' })}.${encodeSegment(claims)}.signature`;
}

describe('getAccessTokenExpiresAt', () => {
  it("counts the token's own lifetime from when the browser received it, whatever the device clock says", () => {
    // The issuer's clock is years from the device's, which must not matter. The name needs both
    // base64url substitutions and padding, so a plain base64 decode would misread it
    const token = buildToken({ sub: '??>>~', iat: 1_000_000, exp: 1_000_900 });

    expect(token.split('.')[1]).toMatch(/[-_]/);
    expect(getAccessTokenExpiresAt(token, 5_000)).toBe(5_000 + 900_000);
  });

  it.each([
    ['a token that is not three parts', 'not-a-token'],
    ['a payload that is not JSON', 'aGVhZGVy.bm90IGpzb24.signature'],
    ['a payload without its issue and expiry times', buildToken({ sub: 'user' })],
  ])('gives no expiry for %s, so requests are sent as they are', (_label, token) => {
    expect(getAccessTokenExpiresAt(token, 5_000)).toBeNull();
  });
});
