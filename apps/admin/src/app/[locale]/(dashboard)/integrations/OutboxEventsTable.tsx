'use client';

import { RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PermissionGate } from '@/components/PermissionGate';
import { trpc } from '@/lib/trpc';

export interface OutboxEvent {
  id: string;
  eventType: string;
  processed: boolean;
  attempts: number;
  lastError: string | null;
  createdAt: Date | string;
  processedAt: Date | string | null;
}

type OutboxStatus = 'processed' | 'pending' | 'retrying' | 'deadLettered';

function getOutboxStatus(event: OutboxEvent): OutboxStatus {
  if (event.processed) return 'processed';
  if (event.attempts >= 5) return 'deadLettered';
  if (event.attempts > 0) return 'retrying';
  return 'pending';
}

const STATUS_CLASS: Record<OutboxStatus, string> = {
  processed:
    'text-[var(--emerald)] border-[var(--emerald)]/30 bg-[var(--emerald)]/10',
  pending: 'text-[var(--t2)] border-[var(--rim1)] bg-[var(--panel)]',
  retrying: 'text-[var(--amber)] border-[var(--amber)]/30 bg-[var(--amber)]/10',
  deadLettered:
    'text-[var(--crimson)] border-[var(--crimson)]/30 bg-[var(--crimson)]/10',
};

export function OutboxEventsTable({
  initialEvents,
}: {
  initialEvents: OutboxEvent[];
}) {
  const t = useTranslations('integrations');
  const outboxQuery = trpc.integrations.outboxList.useQuery({
    showProcessed: false,
  });
  const retry = trpc.integrations.retryOutboxEvent.useMutation({
    onSuccess: () => {
      toast.success(t('toasts.retrySuccess'));
      void outboxQuery.refetch();
    },
    onError: (error) => {
      toast.error(`${t('toasts.retryError')}: ${error.message}`);
    },
  });
  const events = (outboxQuery.data?.data ?? initialEvents) as OutboxEvent[];
  const isEmptyLoading = outboxQuery.isLoading && events.length === 0;

  return (
    <Card className="bg-[var(--obsidian)] border-[var(--rim1)]">
      <CardHeader>
        <CardTitle className="text-xl text-[var(--gold)]">
          {t('outbox')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-[var(--rim1)]">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-b-[var(--rim1)]">
                <TableHead className="text-start text-[var(--t2)]">
                  {t('columns.id')}
                </TableHead>
                <TableHead className="text-start text-[var(--t2)]">
                  {t('columns.type')}
                </TableHead>
                <TableHead className="text-start text-[var(--t2)]">
                  {t('columns.status')}
                </TableHead>
                <TableHead className="text-start text-[var(--t2)]">
                  {t('columns.attempts')}
                </TableHead>
                <TableHead className="text-start text-[var(--t2)]">
                  {t('columns.error')}
                </TableHead>
                <TableHead className="text-start text-[var(--t2)]">
                  {t('columns.date')}
                </TableHead>
                <TableHead className="text-start text-[var(--t2)]">
                  {t('columns.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isEmptyLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-24 text-center text-[var(--t3)]"
                  >
                    {t('loading')}
                  </TableCell>
                </TableRow>
              ) : events.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-24 text-center text-[var(--t3)]"
                  >
                    {t('empty')}
                  </TableCell>
                </TableRow>
              ) : (
                events.map((event) => {
                  const status = getOutboxStatus(event);
                  const isDeadLettered = status === 'deadLettered';
                  const isRetryingThis =
                    retry.isPending && retry.variables?.eventId === event.id;

                  return (
                    <TableRow
                      key={event.id}
                      className="border-b-[var(--rim1)] hover:bg-[var(--rim1)]"
                    >
                      <TableCell
                        className="font-medium text-[var(--t1)]"
                        dir="ltr"
                      >
                        {event.id.substring(0, 8)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="text-[var(--gold)] border-[var(--gold-br)] bg-[var(--gold-bg)]"
                        >
                          {event.eventType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={STATUS_CLASS[status]}
                        >
                          {t(`status.${status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            event.attempts > 0
                              ? 'text-[var(--crimson)]'
                              : 'text-[var(--t2)]'
                          }
                        >
                          {event.attempts}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-sm whitespace-normal break-words text-sm">
                        {isDeadLettered ? (
                          <span
                            className={
                              event.lastError
                                ? 'text-[var(--crimson)]'
                                : 'text-[var(--t3)]'
                            }
                          >
                            {event.lastError ?? t('noError')}
                          </span>
                        ) : (
                          <span className="text-[var(--t3)]">
                            {t('notApplicable')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-[var(--t2)]">
                        {new Date(event.createdAt).toLocaleString('ar-EG')}
                      </TableCell>
                      <TableCell>
                        {isDeadLettered && (
                          <PermissionGate
                            resource="integrations"
                            action="connect"
                          >
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isRetryingThis}
                              onClick={() =>
                                retry.mutate({ eventId: event.id })
                              }
                            >
                              <RotateCcw />
                              {isRetryingThis
                                ? t('actions.retrying')
                                : t('actions.retry')}
                            </Button>
                          </PermissionGate>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
