import { router } from '../trpc';
import { dashboardRouter } from './dashboard';
import { ordersRouter } from './orders';
import { productsRouter } from './products';
import { categoriesRouter } from './categories';
import { inventoryRouter } from './inventory';

export const appRouter = router({
    dashboard: dashboardRouter,
    orders: ordersRouter,
    products: productsRouter,
    categories: categoriesRouter,
    inventory: inventoryRouter,
});

export type AppRouter = typeof appRouter;
