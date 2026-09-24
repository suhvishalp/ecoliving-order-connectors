import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import type { Cart } from '@commercetools/platform-sdk';
import { applyRules, type Thresholds } from './rules.js';
import { readThresholds } from './config.js';

/**
 * Session 8.2 — a Connect `service` application is an HTTP server commercetools runs for you.
 *
 * Deployed, this is reachable at {CONNECT_SERVICE_URL}/cart-rules and the API Extension registered by
 * post-deploy.ts points at it. Locally it is just a port. The handler cannot tell the difference.
 */
const app = express();
app.use(express.json({ limit: '10mb' }));

app.post('/cart-rules', async (req: Request, res: Response) => {
  const started = Date.now();
  const correlationId = req.header('X-Correlation-ID') ?? 'local';
  try {
    const cart = req.body?.resource?.obj as Cart | undefined;
    if (!cart) {
      // Nothing to judge — approve rather than fail the caller's write.
      return res.status(200).send();
    }
    const cfg: Thresholds = await readThresholds();
    const result = applyRules(cart, cfg);
    console.log(
      JSON.stringify({ correlationId, action: req.body?.action, cartId: cart.id,
        status: result.status, summary: result.summary, ms: Date.now() - started }),
    );
    return result.body ? res.status(result.status).json(result.body) : res.status(result.status).send();
  } catch (err) {
    // An Extension that errors fails the CALLER's write. Approving on an internal fault is a
    // deliberate choice (fail open) — Session 9.4 asks whether it is the right one for each rule.
    console.error(JSON.stringify({ correlationId, error: (err as Error).message }));
    return res.status(200).send();
  }
});

app.get('/cart-rules/health', (_req, res) => res.status(200).json({ ok: true }));

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => console.log(`cart-rules-service listening on :${port}`));
