import 'dotenv/config';
import express, { type Express } from 'express';
import { readConfiguration } from './utils/config.utils.js';
import { logger } from './utils/logger.utils.js';
import { correlationMiddleware } from './middleware/correlation.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import serviceRouter from './routes/service.route.js';
import statusRouter from './routes/status.route.js';

// Fail fast: if configuration is missing, die at startup with a clear message rather than at the first
// cart write with a 502 nobody can explain.
readConfiguration();

export const app: Express = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(correlationMiddleware);

app.use('/status', statusRouter);
// Must match `endpoint` in connect.yaml, or the platform's traffic 404s.
app.use('/cart-rules', serviceRouter);

app.use(errorMiddleware);

const PORT = Number(process.env.PORT ?? 8080);
/* c8 ignore start */
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => logger.info('cart-rules-service listening', { port: PORT }));
}
/* c8 ignore stop */
export default app;
