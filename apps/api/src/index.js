import { Hono } from 'hono';
import { auth } from './auth';
import { ordersRoute } from './routes/orders';
import { shippingRoute } from './routes/shipping';
import { paymobRoute } from './routes/webhooks/paymob';
import { bostaRoute } from './routes/webhooks/bosta';
import { auditMiddleware } from './middlewares/audit';
import { orgsRouter } from './routes/orgs';
import { notificationsRouter } from './routes/notifications';
import { productsRouter } from './routes/products';
import { categoriesRouter } from './routes/categories';
const app = new Hono();
app.use('*', auditMiddleware());
app.get('/health', (c) => {
    return c.json({ data: { status: 'ok', environment: 'development' }, error: null, meta: null });
});
app.on(['POST', 'GET'], '/api/auth/**', (c) => {
    return auth.handler(c.req.raw);
});
app.route('/api/orders', ordersRoute);
app.route('/api/shipping', shippingRoute);
app.route('/api/webhooks/paymob', paymobRoute);
app.route('/api/webhooks/bosta', bostaRoute);
app.route('/api/orgs', orgsRouter);
app.route('/api/notifications', notificationsRouter);
app.route('/api/products', productsRouter);
app.route('/api/categories', categoriesRouter);
export default app;
