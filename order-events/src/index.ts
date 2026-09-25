import 'dotenv/config';
import express, { type Express } from 'express';
import { readConfiguration } from './utils/config.utils.js';
import { logger } from './utils/logger.utils.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import eventRouter from './routes/event.route.js';
import statusRouter from './routes/status.route.js';

readConfiguration();

export const app: Express = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));

app.use('/status', statusRouter);
// Must match `endpoint` in connect.yaml.
app.use('/order-events', eventRouter);

app.use(errorMiddleware);

const PORT = Number(process.env.PORT ?? 8080);
/* c8 ignore start */
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => logger.info('order-events listening', { port: PORT }));
}
/* c8 ignore stop */
export default app;
