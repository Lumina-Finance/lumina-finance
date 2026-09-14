import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearUserScopedCache } from '@/api/cache/session';
import { currencyKeys } from '@/api/cache/queryKeys';
import { currencyQueryOptions } from '@/api/currency/hooks';

const currencies = [{ id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 }];
const fetchMock = vi.fn();
const clients: QueryClient[] = [];
const subscriptions: (() => void)[] = [];

/** Creates an isolated client whose resources are released after the test */
function createClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return client;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

describe('the cache boundary when a session starts', () => {
  it('retains the loaded currency query and freshness through repeated session clears', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(currencies)));
    const client = createClient();
    await client.fetchQuery(currencyQueryOptions);
    const query = client.getQueryCache().find({ queryKey: currencyKeys.list(), exact: true });
    const updatedAt = query?.state.dataUpdatedAt;

    clearUserScopedCache(client);
    clearUserScopedCache(client);

    expect(client.getQueryCache().find({ queryKey: currencyKeys.list(), exact: true })).toBe(query);
    expect(client.getQueryData(currencyKeys.list())).toEqual(currencies);
    expect(client.getQueryState(currencyKeys.list())?.dataUpdatedAt).toBe(updatedAt);
    const observer = new QueryObserver(client, currencyQueryOptions);
    subscriptions.push(observer.subscribe(() => {}));
    expect(observer.getCurrentResult().data).toEqual(currencies);
    expect(observer.getCurrentResult().isFetching).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('removes all private queries and mutations with currencies present=%s', async (hasCurrencies) => {
    const client = createClient();
    if (hasCurrencies) client.setQueryData(currencyKeys.list(), currencies);
    const privateKeys = [
      ['accounts'], ['transactions'], ['totp', 'setup'], ['oidc', 'identities'],
      ['unknown-private-key'], ['currencies', 'private'],
    ];
    for (const key of privateKeys) client.setQueryData(key, { previousUser: 'private' });
    const privateQuery = vi.fn();
    const observer = new QueryObserver(client, { queryKey: ['accounts'], queryFn: privateQuery, staleTime: Infinity });
    subscriptions.push(observer.subscribe(() => {}));
    expect(client.getQueryCache().find({ queryKey: ['accounts'], exact: true })?.isActive()).toBe(true);
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async (variables: { note: string }) => variables.note,
    });
    await mutation.execute({ note: 'Private mutation input' });
    expect(client.getMutationCache().getAll()).toHaveLength(1);

    clearUserScopedCache(client);

    for (const key of privateKeys) expect(client.getQueryState(key)).toBeUndefined();
    expect(client.getQueryCache().getAll()).toHaveLength(hasCurrencies ? 1 : 0);
    expect(client.getMutationCache().getAll()).toEqual([]);
    expect(privateQuery).not.toHaveBeenCalled();
  });

  it('keeps a mounted currency observer on its original pending request', async () => {
    let resolveRequest!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => { resolveRequest = resolve; }));
    const client = createClient();
    const observer = new QueryObserver(client, currencyQueryOptions);
    subscriptions.push(observer.subscribe(() => {}));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const query = client.getQueryCache().find({ queryKey: currencyKeys.list(), exact: true });

    clearUserScopedCache(client);

    expect(client.getQueryCache().find({ queryKey: currencyKeys.list(), exact: true })).toBe(query);
    resolveRequest(new Response(JSON.stringify(currencies)));
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(currencies));
    expect(client.getQueryData(currencyKeys.list())).toEqual(currencies);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not let a removed private request repopulate the cache when its transport resolves', async () => {
    const client = createClient();
    client.setQueryData(currencyKeys.list(), currencies);
    let resolveRequest!: (records: string[]) => void;
    const pendingRequest = new Promise<string[]>((resolve) => { resolveRequest = resolve; });
    const observer = new QueryObserver(client, { queryKey: ['accounts'], queryFn: () => pendingRequest });
    subscriptions.push(observer.subscribe(() => {}));
    expect(observer.getCurrentResult().isFetching).toBe(true);

    clearUserScopedCache(client);
    resolveRequest(['Previous user account']);
    await pendingRequest;

    // Let the resolved transport and queued query notifications settle before checking membership
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.getQueryState(['accounts'])).toBeUndefined();
    expect(client.getQueryData(currencyKeys.list())).toEqual(currencies);
  });

  it('retains failed currency state without silently retrying at the session boundary', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const client = createClient();
    const first = new QueryObserver(client, currencyQueryOptions);
    subscriptions.push(first.subscribe(() => {}));
    await vi.waitFor(() => expect(first.getCurrentResult().isError).toBe(true));
    const query = client.getQueryCache().find({ queryKey: currencyKeys.list(), exact: true });
    const error = query?.state.error;

    clearUserScopedCache(client);

    expect(client.getQueryCache().find({ queryKey: currencyKeys.list(), exact: true })).toBe(query);
    expect(client.getQueryState(currencyKeys.list())?.error).toBe(error);
    const next = new QueryObserver(client, currencyQueryOptions);
    subscriptions.push(next.subscribe(() => {}));
    expect(next.getCurrentResult().isError).toBe(true);
    expect(next.getCurrentResult().isFetching).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
