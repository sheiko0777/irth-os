import { getTranslations } from 'next-intl/server';
import { serverCaller } from '@/server/caller';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface OutboxEvent {
    id: string;
    eventType: string;
    attempts: number;
    createdAt: Date;
}

export default async function IntegrationsPage() {
    const t = await getTranslations('integrations');
    const trpc = await serverCaller();
    const response = await trpc.integrations.outboxList({ showProcessed: false });
    const events = (response.data || []) as OutboxEvent[];

    return (
        <div className="flex flex-col gap-6 p-6">
            <h1 className="text-3xl font-bold font-cairo text-[var(--gold)]">{t('title')}</h1>

            <Card className="bg-[var(--obsidian)] border-[var(--rim1)]">
                <CardHeader>
                    <CardTitle className="text-xl text-[var(--gold)]">{t('outbox')}</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border border-[var(--rim1)]">
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent border-b-[var(--rim1)]">
                                    <TableHead className="text-right text-[var(--t2)]">{t('columns.id')}</TableHead>
                                    <TableHead className="text-right text-[var(--t2)]">{t('columns.type')}</TableHead>
                                    <TableHead className="text-right text-[var(--t2)]">{t('columns.attempts')}</TableHead>
                                    <TableHead className="text-right text-[var(--t2)]">{t('columns.date')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {events.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-24 text-center text-[var(--t3)]">
                                            {t('empty')}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    events.map((event) => (
                                        <TableRow key={event.id} className="border-b-[var(--rim1)] hover:bg-[var(--rim1)]">
                                            <TableCell className="font-medium text-[var(--t1)]">
                                                {event.id.substring(0, 8)}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-[var(--gold)] border-[var(--gold-br)] bg-[var(--gold-bg)]">
                                                    {event.eventType}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <span className={event.attempts > 0 ? "text-[var(--crimson)]" : "text-[var(--t2)]"}>
                                                    {event.attempts}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-[var(--t2)]">
                                                {new Date(event.createdAt).toLocaleString('ar-EG')}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
