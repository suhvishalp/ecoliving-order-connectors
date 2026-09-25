import 'dotenv/config';
import express from 'express';
import { apiRoot } from './client.js';
import { decode, handle, type Deps, type OrderSnapshot, type TransitionResult } from './handler.js';

/**
 * Session 8.3 — the Event application's HTTP surface.
 *
 * Deployed, Connect's message broker calls this. Locally, you call it yourself with the same envelope
 * (see README — "Replaying an event locally"). The handler cannot tell the difference, which is
 * exactly why the local test is worth anything.
 *
 * The acknowledgement contract: 2xx discards the message; anything else brings it back. There is no
 * third option, and "log the error and return 200" is a decision to drop data — so make it on purpose.
 */
const app = express();
app.use(express.json());

const deps: Deps = {
  targetState: process.env.TARGET_STATE_KEY ?? 'order-picked',

  async loadOrder(orderId: string): Promise<OrderSnapshot | null> {
    try {
      const { body } = await apiRoot
        .orders().withId({ ID: orderId })
        .get({ queryArgs: { expand: ['state'] } })
        .execute();
      return {
        id: body.id,
        version: body.version,
        orderNumber: body.orderNumber ?? null,
        stateKey: body.state?.obj?.key ?? null,
      };
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw err;
    }
  },

  async transition(order: OrderSnapshot, stateKey: string): Promise<TransitionResult> {
    try {
      await apiRoot.orders().withId({ ID: order.id }).post({
        body: {
          version: order.version,
          actions: [
            { action: 'transitionState', state: { typeId: 'state', key: stateKey } },
            { action: 'changeOrderState', orderState: 'Confirmed' },
          ],
        },
      }).execute();
      return { ok: true };
    } catch (err) {
      const status = statusOf(err);
      // 409 (someone else moved it) and 429 / 5xx are worth another delivery. Other 4xx are not:
      // the state machine refused, and it will refuse the redelivery too.
      const transient = status === 409 || status === 429 || status === undefined || status >= 500;
      return { ok: false, permanent: !transient, detail: `HTTP ${status ?? 'network'}: ${messageOf(err)}` };
    }
  },
};

app.post('/order-events', async (req, res) => {
  try {
    const outcome = await handle(decode(req.body), deps);
    console.log(JSON.stringify(outcome));
    return res.status(outcome.ack ? 204 : 500).send();
  } catch (err) {
    console.error(JSON.stringify({ error: messageOf(err) }));
    return res.status(500).send();          // unknown failure -> redeliver
  }
});

app.get('/order-events/health', (_req, res) => res.status(200).json({ ok: true }));

function statusOf(err: unknown): number | undefined {
  const s = (err as { statusCode?: number | string })?.statusCode;
  return typeof s === 'number' ? s : undefined;
}
function messageOf(err: unknown): string {
  return (err as Error)?.message ?? String(err);
}

const port = Number(process.env.PORT ?? 8081);
app.listen(port, () => console.log(`order-events listening on :${port}`));
