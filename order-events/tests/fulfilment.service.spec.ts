import { describe, expect, it, vi } from 'vitest';
import { handleMessage, type Deps } from '../src/services/fulfilment.service.js';
import type { PlatformMessage } from '../src/services/envelope.service.js';
import type { OrderSnapshot } from '../src/services/order.service.js';

const ORDER: OrderSnapshot = { id: 'o1', version: 3, orderNumber: 'LHC-20260918-AB12CD', stateKey: 'order-placed' };

const deps = (over: Partial<Deps> = {}) => {
  const transition = vi.fn(async () => ({ ok: true }) as const);
  const loadOrder = vi.fn(async () => ORDER as OrderSnapshot | null);
  return {
    targetStateKey: 'order-picked',
    confirmOrderState: true,
    maxMessageAgeHours: 72,
    loadOrder,
    transition,
    now: () => new Date('2026-09-25T12:00:00Z'),
    ...over,
  } as Deps & { transition: typeof transition; loadOrder: typeof loadOrder };
};

const paid = (over: Partial<PlatformMessage> = {}): PlatformMessage => ({
  id: 'm1',
  type: 'OrderPaymentStateChanged',
  paymentState: 'Paid',
  createdAt: '2026-09-25T11:59:00Z',
  sequenceNumber: 2,
  resource: { typeId: 'order', id: 'o1' },
  ...over,
});

describe('what the handler acts on', () => {
  it('transitions a paid order and acknowledges', async () => {
    const d = deps();
    const out = await handleMessage(paid(), d);
    expect(out).toEqual({ ack: true, detail: 'LHC-20260918-AB12CD -> order-picked' });
    expect(d.transition).toHaveBeenCalledWith(ORDER, 'order-picked', true);
  });

  it('acknowledges message types it did not subscribe to — including the platform test notification', async () => {
    const d = deps();
    for (const type of ['OrderCreated', 'ResourceCreated', 'SubscriptionTest']) {
      expect((await handleMessage(paid({ type }), d)).ack).toBe(true);
    }
    expect(d.transition).not.toHaveBeenCalled();
  });

  it('acknowledges a payment state that is not Paid', async () => {
    const d = deps();
    expect((await handleMessage(paid({ paymentState: 'Pending' }), d)).ack).toBe(true);
    expect(d.transition).not.toHaveBeenCalled();
  });
});

describe('idempotency — stateless, via the order itself', () => {
  it('does not transition twice when the order is already in the target state', async () => {
    const d = deps({ loadOrder: vi.fn(async () => ({ ...ORDER, stateKey: 'order-picked' })) });
    const out = await handleMessage(paid(), d);
    expect(out.ack).toBe(true);
    expect(out.detail).toContain('already order-picked');
    expect(d.transition).not.toHaveBeenCalled();
  });

  it('a redelivery of the identical message is harmless', async () => {
    const states = ['order-placed', 'order-picked'];
    let i = 0;
    const d = deps({ loadOrder: vi.fn(async () => ({ ...ORDER, stateKey: states[i++]! })) });
    await handleMessage(paid(), d);
    await handleMessage(paid(), d);
    expect(d.transition).toHaveBeenCalledTimes(1);
  });

  it('re-fetches by id rather than trusting the payload (payloadNotIncluded is survivable)', async () => {
    const d = deps();
    await handleMessage(paid({ payloadNotIncluded: { reason: 'size', payloadType: 'OrderPaymentStateChanged' } }), d);
    expect(d.loadOrder).toHaveBeenCalledWith('o1');
  });
});

describe('failure classification — acknowledging is a data-retention decision', () => {
  it('acknowledges a vanished order rather than retrying it for seven days', async () => {
    const d = deps({ loadOrder: vi.fn(async () => null) });
    const out = await handleMessage(paid(), d);
    expect(out).toEqual({ ack: true, detail: 'order o1 not found — dropped' });
  });

  it('acknowledges a permanent refusal from the State machine', async () => {
    const d = deps({ transition: vi.fn(async () => ({ ok: false, permanent: true, detail: 'HTTP 400' })) });
    expect((await handleMessage(paid(), d)).ack).toBe(true);
  });

  it('NACKS a transient failure so the platform redelivers', async () => {
    const d = deps({ transition: vi.fn(async () => ({ ok: false, permanent: false, detail: 'HTTP 503' })) });
    expect((await handleMessage(paid(), d)).ack).toBe(false);
  });

  it('acknowledges a message with no order reference', async () => {
    expect((await handleMessage(paid({ resource: undefined }), deps())).ack).toBe(true);
  });
});

describe('the backlog guard', () => {
  it('drops a message older than the limit — a weekend outage must not stampede', async () => {
    const d = deps();
    const out = await handleMessage(paid({ createdAt: '2026-09-20T12:00:00Z' }), d);
    expect(out.ack).toBe(true);
    expect(out.detail).toContain('dropped');
    expect(d.transition).not.toHaveBeenCalled();
  });

  it('processes a message with no createdAt rather than guessing its age', async () => {
    const d = deps();
    expect((await handleMessage(paid({ createdAt: undefined }), d)).ack).toBe(true);
    expect(d.transition).toHaveBeenCalled();
  });
});
