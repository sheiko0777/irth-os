import { Hono } from 'hono';
import { bostaWebhookRoute } from './webhooks/bosta-webhook';
import { aramexWebhookRoute } from './webhooks/aramex-webhook';

const webhooksRouter = new Hono();

// Mount the new courier settlement webhooks
webhooksRouter.route('/bosta', bostaWebhookRoute);
webhooksRouter.route('/aramex', aramexWebhookRoute);

export { webhooksRouter };
