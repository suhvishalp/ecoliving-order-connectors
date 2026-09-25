import { Router } from 'express';
import { post } from '../controllers/cart-rules.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const serviceRouter: Router = Router();

/**
 * Mounted at the `endpoint` declared in connect.yaml (`/cart-rules`). If the two ever disagree the
 * platform's traffic 404s and the Extension fails every cart write — so they are asserted in the tests.
 */
serviceRouter.post('/', authMiddleware, (req, res, next) => {
  post(req, res).catch(next);
});

export default serviceRouter;
