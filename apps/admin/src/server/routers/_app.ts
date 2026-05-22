import { router } from '../trpc';
import { dashboardRouter } from './dashboard';
import { ordersRouter } from './orders';
import { productsRouter } from './products';
import { categoriesRouter } from './categories';
import { inventoryRouter } from './inventory';
import { integrationsRouter } from './integrations';
import { financeRouter } from './finance';
import { settingsRouter } from './settings';
import { etaRouter } from './eta';
import { courierRouter } from './courier';

export const appRouter = router({
    dashboard: dashboardRouter,
    orders: ordersRouter,
    products: productsRouter,
    categories: categoriesRouter,
    inventory: inventoryRouter,
    integrations: integrationsRouter,
    finance: financeRouter,
    settings: settingsRouter,
    eta: etaRouter,
    courier: courierRouter,
});

export type AppRouter = typeof appRouter;
