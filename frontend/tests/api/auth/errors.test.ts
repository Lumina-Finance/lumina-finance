/**
 * Covers how a failed response's status and body become the error a screen shows
 *
 * These tests catch regressions where a refusal the server explained nothing about reaches the user
 * as a status code or a blank message
 */
import { describe, expect, it } from 'vitest';
import { buildApiError } from '@/api/auth/errors';

describe('buildApiError', () => {
  it.each([
    ['no body', null],
    ['a JSON body with no explanation', { error: 'boom' }],
    ['an empty explanation', { detail: '' }],
    ['an explanation that is neither a sentence nor a field list', { detail: { code: 'unknown' } }],
  ])('says something went wrong, keeping the status, for %s', (_label, body) => {
    const error = buildApiError(500, body);

    expect(error.message).toBe('Oops, something went wrong. Please try again.');
    expect(error.detail).toBeUndefined();
    expect(error.status).toBe(500);
  });

  it('passes on the sentence the server explained the refusal with', () => {
    expect(buildApiError(409, { detail: 'Tag with this name already exists' })).toMatchObject({
      message: 'Tag with this name already exists',
      detail: 'Tag with this name already exists',
      status: 409,
    });
  });
});
