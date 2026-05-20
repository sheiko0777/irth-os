import { router } from '../trpc';
import { dashboardRouter } from './dashboard';
import { ordersRouter } from './orders';
import { productsRouter } from './products';

export const appRouter = router({
    dashboard: dashboardRouter,
    orders: ordersRouter,
    products: productsRouter,
});

export type AppRouter = typeof appRouter;
