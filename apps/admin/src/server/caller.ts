import { appRouter } from './routers/_app';
import { createContext, t } from './trpc';

const createCaller = t.createCallerFactory(appRouter);

export const serverCaller = async () => {
    const ctx = await createContext();
    return createCaller(ctx);
};
