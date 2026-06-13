/**
 * Keeps mutation pending state visible for a minimum duration while preserving success and error results
 */
export async function runWithMinimumPendingTime<T>(
  minimumPendingMs: number,
  mutation: () => Promise<T>,
): Promise<T> {
  if (minimumPendingMs <= 0) return mutation();

  const minimumPending = new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, minimumPendingMs);
  });

  try {
    const result = await mutation();
    await minimumPending;
    return result;
  } catch (error) {
    await minimumPending;
    throw error;
  }
}
