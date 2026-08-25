'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import { useState, type ReactNode } from 'react';
import { trpc } from '@/lib/trpc';

export function TrpcProvider({ children }: { children: ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
                },
            })
    );
    const [trpcClient] = useState(() =>
        trpc.createClient({
            // superjson, because money is bigint minor units and plain JSON
            // cannot carry a bigint at all — JSON.stringify throws outright.
            // It also makes Date survive the round trip: without it every
            // timestamp arrived as a string while the inferred type still
            // claimed Date, so the client types were quietly lying.
            // Must match the transformer on the server in src/server/trpc.ts.
            links: [httpBatchLink({ url: '/api/trpc', transformer: superjson })],
        })
    );

    return (
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </trpc.Provider>
    );
}
