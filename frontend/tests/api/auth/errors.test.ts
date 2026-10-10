/**
 * Covers how a failed response's status and body become the error a screen shows
 *
 * These tests catch regressions where a refusal the server explained nothing about reaches the user
 * as a status code or a blank message, or where a validation refusal reaches them as
 * "[object Object]" rather than naming the field and its problem
 */
import { describe, expect, it } from 'vitest';
import { buildApiError } from '@/api/auth/errors';

describe('buildApiError', () => {
  it.each([
    ['no body', null],
    ['a JSON body with no explanation', { error: 'boom' }],
    ['an empty explanation', { detail: '' }],
    ['an explanation that is neither a sentence nor a field list', { detail: { code: 'unknown' } }],
    ['an empty field list', { detail: [] }],
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

  it('names the fields a validation refusal lists, keeping their reasons out of the message', () => {
    const error = buildApiError(422, {
      detail: [
        { type: 'greater_than_equal', loc: ['body', 'credit_limit'], msg: 'Input should be greater than or equal to 0' },
        { type: 'missing', loc: ['body', 'items', 0, 'amount'], msg: 'Field required' },
        { type: 'model_attributes_type', loc: ['body'], msg: 'Input should be a valid dictionary' },
      ],
    });

    expect(error).toMatchObject({
      message: "Oops, the credit limit and amount weren't accepted. Please check them and try again.",
      fieldErrors: [
        { field: 'credit_limit', message: 'Input should be greater than or equal to 0' },
        { field: 'amount', message: 'Field required' },
        { field: '', message: 'Input should be a valid dictionary' },
      ],
      status: 422,
    });
    expect(error.detail).toBeUndefined();
  });

  it.each([
    [['credit_limit'], "Oops, the credit limit wasn't accepted. Please check it and try again."],
    [['credit_limit', 'name', 'credit_limit', 'amount'], "Oops, the credit limit, name and amount weren't accepted. Please check them and try again."],
    [[], "Oops, some of what you entered wasn't accepted. Please check it and try again."],
  ])('words a refusal of %j as one sentence', (fields, message) => {
    const detail = fields.length > 0
      ? fields.map((field) => ({ loc: ['body', field], msg: 'Field required' }))
      : [{ loc: ['body'], msg: 'Input should be a valid dictionary' }];

    expect(buildApiError(422, { detail }).message).toBe(message);
  });
});
