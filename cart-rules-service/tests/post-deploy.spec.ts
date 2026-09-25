import { describe, expect, it, vi } from 'vitest';
import { ensureCartRulesExtension, deleteCartRulesExtension, EXTENSION_KEY } from '../src/connector/actions.js';

/**
 * The property that matters: a redeploy must never leave a window with no Extension registered. So the
 * second run UPDATES; it does not delete and recreate.
 */
function apiRootWith(existing: { version: number } | undefined) {
  const post = vi.fn(() => ({ execute: async () => ({ body: {} }) }));
  const del = vi.fn(() => ({ execute: async () => ({ body: {} }) }));
  const withKey = vi.fn(() => ({ post, delete: del }));
  const get = vi.fn(() => ({ execute: async () => ({ body: { results: existing ? [existing] : [] } }) }));
  const extensions = vi.fn(() => ({ get, post, withKey }));
  return { apiRoot: { extensions } as never, post, del, withKey, get };
}

describe('postDeploy registration', () => {
  it('creates the Extension when none exists', async () => {
    const h = apiRootWith(undefined);
    await ensureCartRulesExtension(h.apiRoot, 'https://svc.commercetools.app/cart-rules', 'sec');
    expect(h.post).toHaveBeenCalledTimes(1);
    expect(h.del).not.toHaveBeenCalled();
    const body = h.post.mock.calls[0]![0]!.body;
    expect(body.key).toBe(EXTENSION_KEY);
    expect(body.destination.url).toBe('https://svc.commercetools.app/cart-rules');
  });

  it('registers WITH authentication — an open destination is an open door', async () => {
    const h = apiRootWith(undefined);
    await ensureCartRulesExtension(h.apiRoot, 'https://svc.commercetools.app/cart-rules', 'sec');
    const auth = h.post.mock.calls[0]![0]!.body.destination.authentication;
    // The discriminator must be `AuthorizationHeader`; `AuthorizationHeaderAuthentication` is rejected
    // with InvalidJsonInput and, because postDeploy failures are quiet, would never register at all.
    expect(auth.type).toBe('AuthorizationHeader');
    expect(auth.headerValue).toBe('Bearer sec');
  });

  it('UPDATES in place on a redeploy — never delete-then-recreate, which opens a gap window', async () => {
    const h = apiRootWith({ version: 7 });
    await ensureCartRulesExtension(h.apiRoot, 'https://svc.commercetools.app/cart-rules', 'sec');
    expect(h.del).not.toHaveBeenCalled();
    const body = h.post.mock.calls[0]![0]!.body;
    expect(body.version).toBe(7);
    expect(body.actions.map((a: { action: string }) => a.action)).toEqual([
      'changeDestination', 'changeTriggers', 'setTimeoutInMs',
    ]);
  });

  it('sets a 2s timeout — the platform default, and a deliberate fail-fast', async () => {
    const h = apiRootWith(undefined);
    await ensureCartRulesExtension(h.apiRoot, 'https://x/cart-rules', 'sec');
    expect(h.post.mock.calls[0]![0]!.body.timeoutInMs).toBe(2000);
  });
});

describe('preUndeploy teardown', () => {
  it('deletes the Extension with its version', async () => {
    const h = apiRootWith({ version: 3 });
    await deleteCartRulesExtension(h.apiRoot);
    expect(h.del).toHaveBeenCalledWith({ queryArgs: { version: 3 } });
  });

  it('is a no-op when it is already gone — teardown must not strand what follows it', async () => {
    const h = apiRootWith(undefined);
    await expect(deleteCartRulesExtension(h.apiRoot)).resolves.toBeUndefined();
    expect(h.del).not.toHaveBeenCalled();
  });
});
