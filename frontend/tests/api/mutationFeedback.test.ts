/**
 * Covers the shared mutation feedback timing helper used by delete mutations
 *
 * These tests catch regressions where success or error results resolve before the minimum pending duration
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithMinimumPendingTime } from '@/api/mutationFeedback';

afterEach(() => {
  vi.useRealTimers();
});

describe('mutation feedback timing', () => {
  it('returns mutation results immediately when no pending duration is required', async () => {
    const mutation = vi.fn().mockResolvedValue('deleted');

    await expect(runWithMinimumPendingTime(0, mutation)).resolves.toBe('deleted');

    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it('waits for the minimum pending duration before resolving success results', async () => {
    vi.useFakeTimers();
    let settled = false;
    const result = runWithMinimumPendingTime(250, () => Promise.resolve('deleted')).then((value) => {
      settled = true;
      return value;
    });

    await vi.advanceTimersByTimeAsync(249);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('deleted');
    expect(settled).toBe(true);
  });

  it('waits for the minimum pending duration before rejecting errors', async () => {
    vi.useFakeTimers();
    const error = new Error('delete failed');
    let settled = false;
    const result = runWithMinimumPendingTime(250, () => Promise.reject(error)).catch((reason) => {
      settled = true;
      throw reason;
    });
    const assertion = expect(result).rejects.toBe(error);

    await vi.advanceTimersByTimeAsync(249);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(settled).toBe(true);
  });
});
