import { Router } from 'express';
import { post } from '../controllers/event.controller.js';

/** Mounted at the `endpoint` declared in connect.yaml (`/order-events`). */
const eventRouter: Router = Router();
eventRouter.post('/', (req, res, next) => {
  post(req, res).catch(next);
});
export default eventRouter;
