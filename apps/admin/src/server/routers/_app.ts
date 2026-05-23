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
import { returnsRouter } from './returns';
import { purchasingRouter } from './purchasing';
import { customersRouter } from './customers';
import { analyticsRouter } from './analytics';
import { couponsRouter } from './coupons';

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
    returns: returnsRouter,
    purchasing: purchasingRouter,
    customers: customersRouter,
    analytics: analyticsRouter,
    coupons: couponsRouter,
});

export type AppRouter = typeof appRouter;
