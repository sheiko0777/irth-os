import { router } from '../trpc';
import { dashboardRouter } from './dashboard';
import { ordersRouter } from './orders';
import { deliveriesRouter } from './deliveries';
import { repCashRouter } from './repCash';
import { salesRouter } from './sales';
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
import { bulkRouter } from './bulk';
import { notificationsRouter } from './notifications';
import { stocktakingRouter } from './stocktaking';
import { pricelistsRouter } from './pricelists';
import { shippingRouter } from './shipping';
import { campaignsRouter } from './campaigns';
import { membersRouter } from './members';
import { giftCardsRouter } from './giftCards';
import { customerSegmentsRouter } from './customerSegments';
import { platformAdminRouter } from './platformAdmin';
import { meRouter } from './me';
import { deadLettersRouter } from './deadLetters';
import { auditRouter } from './audit';
import { rolesRouter } from './roles';
import { accountsRouter } from './accounts';

export const appRouter = router({
    audit: auditRouter,
    me: meRouter,
    dashboard: dashboardRouter,
    orders: ordersRouter,
    deliveries: deliveriesRouter,
    repCash: repCashRouter,
    sales: salesRouter,
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
    bulk: bulkRouter,
    notifications: notificationsRouter,
    stocktaking: stocktakingRouter,
    pricelists: pricelistsRouter,
    shipping: shippingRouter,
    campaigns: campaignsRouter,
    members: membersRouter,
    roles: rolesRouter,
    accounts: accountsRouter,
    giftCards: giftCardsRouter,
    customerSegments: customerSegmentsRouter,
    platformAdmin: platformAdminRouter,
    deadLetters: deadLettersRouter,
});

export type AppRouter = typeof appRouter;
