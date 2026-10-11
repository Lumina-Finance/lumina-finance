/**
 * Covers how provider sign-in requests read the server's refusals
 *
 * Catches a closed-registration refusal reaching the callback page as a generic failure, which
 * would show "Sign-in failed" instead of sending the newcomer back to the login page to say why
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeOidcCallback, RegistrationClosedError } from '@/api/oidc';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider sign-in refusals', () => {
  it('reads a closed-registration refusal as its own error', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ detail: 'Registration is closed on this instance' }),
    });

    await expect(completeOidcCallback({ code: 'code', state: 'state' })).rejects.toBeInstanceOf(
      RegistrationClosedError,
    );
  });
});
