import { appRouter } from './routers/_app';
import { createContext } from './trpc';

const createCaller = appRouter.createCaller;

export const serverCaller = async () => {
    const ctx = await createContext();
    return createCaller(ctx);
};
