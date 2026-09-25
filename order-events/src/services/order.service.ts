import type { ByProjectKeyRequestBuilder, Order } from '@commercetools/platform-sdk';

/** Just enough of the order to decide, and to write the update. */
export interface OrderSnapshot {
  id: string;
  version: number;
  orderNumber: string | null;
  stateKey: string | null;
}

export type TransitionResult =
  | { ok: true }
  /** `permanent` decides acknowledge-and-drop vs let-the-platform-redeliver. */
  | { ok: false; permanent: boolean; detail: string };

/**
 * The connector talks to the commercetools API DIRECTLY.
 *
 * Session 7's consumer called the BFF's own order-state endpoint, because it ran inside the BFF. A
 * deployed connector runs in Connect's cloud, where a laptop is unreachable — and tunnelling a BFF out
 * to satisfy it would be precisely what Connect exists to stop doing. Nothing is lost: the platform
 * enforces the guarded State machine either way.
 */
export async function loadOrder(
  apiRoot: ByProjectKeyRequestBuilder,
  orderId: string
): Promise<OrderSnapshot | null> {
  try {
    const { body } = await apiRoot
      .orders()
      .withId({ ID: orderId })
      .get({ queryArgs: { expand: ['state'] } })
      .execute();
    return snapshot(body);
  } catch (error) {
    if (statusOf(error) === 404) return null;
    throw error;
  }
}

export async function transitionOrder(
  apiRoot: ByProjectKeyRequestBuilder,
  order: OrderSnapshot,
  stateKey: string,
  confirmOrderState: boolean
): Promise<TransitionResult> {
  try {
    await apiRoot
      .orders()
      .withId({ ID: order.id })
      .post({
        body: {
          version: order.version,
          actions: [
            { action: 'transitionState', state: { typeId: 'state', key: stateKey } },
            ...(confirmOrderState ? [{ action: 'changeOrderState' as const, orderState: 'Confirmed' as const }] : []),
          ],
        },
      })
      .execute();
    return { ok: true };
  } catch (error) {
    const status = statusOf(error);
    // 409 means someone else moved it while we were deciding — worth one more delivery, with a fresh
    // read. 429 and 5xx are the platform asking us to come back. Every other 4xx is the State machine
    // refusing, and it will refuse the redelivery too: retrying for seven days is not a plan.
    const transient = status === undefined || status === 409 || status === 429 || status >= 500;
    return { ok: false, permanent: !transient, detail: `HTTP ${status ?? 'network'}: ${messageOf(error)}` };
  }
}

function snapshot(order: Order): OrderSnapshot {
  return {
    id: order.id,
    version: order.version,
    orderNumber: order.orderNumber ?? null,
    stateKey: order.state?.obj?.key ?? null,
  };
}

export function statusOf(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown })?.statusCode;
  return typeof status === 'number' ? status : undefined;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
