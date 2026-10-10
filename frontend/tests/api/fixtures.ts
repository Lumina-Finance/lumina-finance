/**
 * Stands in for a server that accepts a request and never answers, failing only when the request's
 * signal aborts, with the reason it aborted with
 */
export function answerNever(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    if (init.signal?.aborted) reject(init.signal.reason);
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });
}
