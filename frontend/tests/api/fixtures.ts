/**
 * Stands in for a request read as a whole response, such as the one that saves an import, from the
 * mock that stands in for requests read as their JSON. It answers 200 with what that mock resolves
 * with, and a failure reaches the caller as it was
 */
export function answerAsResponse(answerAsJson: (path: string, init?: RequestInit) => Promise<unknown>) {
  return async (path: string, init?: RequestInit) => Response.json((await answerAsJson(path, init)) ?? null)
}

/**
 * Stands in for a server that accepts a request and never answers, failing only when the request's
 * signal aborts, with the reason it aborted with
 */
export function answerNever(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    if (init.signal?.aborted) reject(init.signal.reason)
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
  })
}
