import { describe, expect, it, vi } from 'vitest';
import { handle, type Deps, type OrderSnapshot, type PlatformMessage } from '../src/handler.js';

const ORDER: OrderSnapshot = { id: 'o1', version: 3, orderNumber: 'LHC-20260918-AB12CD', stateKey: 'order-placed' };

const deps = (over: Partial<Deps> = {}): Deps & { transition: ReturnType<typeof vi.fn> } => {
  const transition = vi.fn(async () => ({ ok: true }) as const);
  return { targetState: 'order-picked', loadOrder: async () => ORDER, transition, ...over } as never;
};

const paid = (): PlatformMessage =>
  ({ id: 'm1', type: 'OrderPaymentStateChanged', paymentState: 'Paid',
     sequenceNumber: 2, resource: { typeId: 'order', id: 'o1' } });

describe('order-events handler (8.3 / 8.4 — push semantics)', () => {
  it('transitions a paid order and acknowledges', async () => {
    const d = deps();
    const out = await handle(paid(), d);
    expect(out).toEqual({ ack: true, detail: 'LHC-20260918-AB12CD -> order-picked' });
    expect(d.transition).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a redelivery without transitioning twice — the guarded state machine IS the dedupe', async () => {
    const d = deps({ loadOrder: async () => ({ ...ORDER, stateKey: 'order-picked' }) });
    const out = await handle(paid(), d);
    expect(out.ack).toBe(true);
    expect(d.transition).not.toHaveBeenCalled();
  });

  it('acknowledges types it does not handle — a Subscription has no condition, so we filter here', async () => {
    const d = deps();
    expect((await handle({ ...paid(), type: 'OrderCreated' }, d)).ack).toBe(true);
    expect((await handle({ ...paid(), paymentState: 'Pending' }, d)).ack).toBe(true);
    expect(d.transition).not.toHaveBeenCalled();
  });

  it('acknowledges a vanished order rather than retrying it for seven days', async () => {
    const d = deps({ loadOrder: async () => null });
    const out = await handle(paid(), d);
    expect(out.ack).toBe(true);
    expect(out.detail).toContain('not found');
  });

  it('acknowledges a permanent refusal from the state machine', async () => {
    const d = deps({ transition: vi.fn(async () => ({ ok: false, permanent: true, detail: 'HTTP 400' })) as never });
    const out = await handle(paid(), d);
    expect(out.ack).toBe(true);
    expect(out.detail).toContain('refused permanently');
  });

  it('fails — and lets the platform redeliver — on a transient failure', async () => {
    const d = deps({ transition: vi.fn(async () => ({ ok: false, permanent: false, detail: 'HTTP 503' })) as never });
    expect((await handle(paid(), d)).ack).toBe(false);
  });
});
