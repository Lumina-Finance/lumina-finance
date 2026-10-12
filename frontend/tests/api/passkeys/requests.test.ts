/**
 * Covers what the passkey requests raise when the server refuses them
 *
 * These tests catch regressions where a passkey request the server explained nothing about reaches
 * the sign-in or verification screen as a status code rather than the friendly sentence
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/auth';
import {
  authenticatePasskey,
  fetchPasskeyAuthenticationOptions,
  fetchPasskeyConfig,
  fetchPasskeyMfaOptions,
  fetchPasskeyResetOptions,
  verifyPasskeyMfa,
  verifyPasskeyReset,
} from '@/api/passkeys/requests';
import type { AuthenticationResponseJSON } from '@simplewebauthn/browser';

const fetchMock = vi.fn();
const credential = { id: 'credential' } as AuthenticationResponseJSON;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('a refused passkey request', () => {
  it.each([
    ['loading the passkey config', () => fetchPasskeyConfig()],
    ['starting a passkey sign-in', () => fetchPasskeyAuthenticationOptions()],
    ['finishing a passkey sign-in', () => authenticatePasskey(credential)],
    ['starting a passkey second factor', () => fetchPasskeyMfaOptions('mfa-token')],
    ['verifying a passkey second factor', () => verifyPasskeyMfa('mfa-token', credential)],
    ['starting a passkey reset check', () => fetchPasskeyResetOptions('mfa-token')],
    ['verifying a passkey reset check', () => verifyPasskeyReset({ token: 'reset-token', new_password: 'new password', mfa_token: 'mfa-token' }, credential)],
  ])('says something went wrong, keeping the status, when %s gets no explanation', async (_label, request) => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));

    const error = await request().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: 'Oops, something went wrong. Please try again.', status: 500 });
  });
});
