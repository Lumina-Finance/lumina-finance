/**
 * Covers what the provider sign-in requests raise when the server refuses them
 *
 * These tests catch regressions where a provider sign-in the server explained nothing about reaches
 * the sign-in or callback page as a status code rather than the friendly sentence
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/auth';
import { beginOidcSignIn, fetchOidcProviders } from '@/api/oidc/requests';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('a refused provider sign-in request', () => {
  it.each([
    ['no body', () => new Response('', { status: 502 })],
    ['an explanation that is not the email conflict', () => new Response(JSON.stringify({ detail: { code: 'other' } }), { status: 502 })],
  ])('says something went wrong, keeping the status, for %s', async (_label, respond) => {
    fetchMock.mockResolvedValueOnce(respond());

    const error = await fetchOidcProviders().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: 'Oops, something went wrong. Please try again.', status: 502 });
  });

  it('passes on the sentence the server explained the refusal with', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Unknown provider' }), { status: 404 }));

    await expect(beginOidcSignIn('nowhere')).rejects.toMatchObject({ message: 'Unknown provider', status: 404 });
  });
});
