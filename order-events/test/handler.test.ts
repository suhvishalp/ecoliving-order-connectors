import { describe, expect, it, vi } from 'vitest';
import { handle, type Deps, type PlatformMessage } from '../src/handler.js';

const deps = (status: number): Deps & { transition: ReturnType<typeof vi.fn> } => ({
  targetState: 'order-picked',
  transition: vi.fn(async () => ({ status, body: '' })),
  orderNumberFor: async () => 'LHC-20260918-AB12CD',
});

const paid = (): PlatformMessage =>
  ({ id: 'm1', type: 'OrderPaymentStateChanged', paymentState: 'Paid',
     sequenceNumber: 2, resource: { typeId: 'order', id: 'o1' } });

describe('order-events handler (8.3 / 8.4 — push semantics)', () => {
  it('transitions a paid order and acknowledges', async () => {
    const d = deps(200);
    const out = await handle(paid(), d);
    expect(out.ack).toBe(true);
    expect(d.transition).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a redelivery without transitioning twice (409 = already past)', async () => {
    const d = deps(409);
    expect((await handle(paid(), d)).ack).toBe(true);
  });

  it('acknowledges types it does not handle — a nack would retry forever', async () => {
    const d = deps(200);
    const out = await handle({ ...paid(), type: 'OrderCreated' }, d);
    expect(out.ack).toBe(true);
    expect(d.transition).not.toHaveBeenCalled();
  });

  it('fails — and lets the platform redeliver — when the transition is transiently broken', async () => {
    expect((await handle(paid(), deps(503))).ack).toBe(false);
  });
});
