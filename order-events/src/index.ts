import 'dotenv/config';
import express from 'express';
import { apiRoot } from './client.js';
import { decode, handle, type Deps } from './handler.js';

/**
 * Session 8.3 — the Event application's HTTP surface.
 *
 * Deployed, Connect's message broker calls this. Locally, you call it yourself with the same envelope
 * (see README — "Replaying an event locally"). The handler cannot tell the difference, which is
 * exactly why the local test is worth anything.
 *
 * The acknowledgement contract: 2xx discards the message; anything else brings it back. There is no
 * third option, and "log the error and return 200" is a decision to drop data.
 */
const app = express();
app.use(express.json());

const deps: Deps = {
  targetState: process.env.TARGET_STATE_KEY ?? 'order-picked',
  async transition(orderNumber, stateKey) {
    const base = process.env.BFF_BASE_URL ?? 'http://localhost:8081';
    const res = await fetch(`${base}/api/orders/${encodeURIComponent(orderNumber)}/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: stateKey }),
    });
    return { status: res.status, body: await res.text() };
  },
  async orderNumberFor(orderId) {
    const { body } = await apiRoot.orders().withId({ ID: orderId }).get().execute();
    return body.orderNumber ?? null;
  },
};

app.post('/order-events', async (req, res) => {
  let outcome;
  try {
    outcome = await handle(decode(req.body), deps);
  } catch (err) {
    console.error(JSON.stringify({ error: (err as Error).message }));
    return res.status(500).send();          // redeliver
  }
  console.log(JSON.stringify(outcome));
  return res.status(outcome.ack ? 204 : 500).send();
});

app.get('/order-events/health', (_req, res) => res.status(200).json({ ok: true }));

const port = Number(process.env.PORT ?? 8081);
app.listen(port, () => console.log(`order-events listening on :${port}`));
