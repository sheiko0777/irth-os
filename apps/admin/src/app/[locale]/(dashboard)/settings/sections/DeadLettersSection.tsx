"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import { useCan } from "@/lib/permissions";
import { toast } from "sonner";
import { formatDate } from "@irth/domain";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

/**
 * Recovery UI for `deadLetters` (see #333/#334): outbox events that
 * permanently failed and moved to `outbox_dead_letters` instead of rotting,
 * unprocessed, in `outbox_events`. Account-level ops surface, not an
 * SETTING_KEYS org setting — self-contained like TwoFactorSection.
 *
 * Hidden for a member: `deadLetters.list`/`.replay` both require
 * `integrations.recover` server-side (payloads here can carry secrets, e.g.
 * an org invite's otpCode), so a member's query would just come back
 * FORBIDDEN — `enabled` skips firing it, and the permission check below skips
 * rendering the empty shell around it.
 */
export function DeadLettersSection() {
  const t = useTranslations("settings.deadLetters");
  const can = useCan();
  const utils = trpc.useUtils();
  const canManage = can("integrations", "recover");

  const { data, isLoading } = trpc.deadLetters.list.useQuery(
    { limit: 50 },
    { enabled: canManage },
  );
  const letters = data?.data ?? [];

  const replayMutation = trpc.deadLetters.replay.useMutation({
    onSuccess: (res) => {
      if (res.error) toast.error(res.error);
      else toast.success(t("replaySuccess"));
      utils.deadLetters.list.invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("replayError")),
  });

  if (!canManage) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <p className="text-sm text-[var(--t2)] mt-1">{t("description")}</p>
      </CardHeader>
      <CardContent>
        {isLoading ? null : letters.length === 0 ? (
          <EmptyState title={t("empty")} icon={AlertTriangle} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.eventType")}</TableHead>
                <TableHead>{t("table.lastError")}</TableHead>
                <TableHead>{t("table.attempts")}</TableHead>
                <TableHead>{t("table.failedAt")}</TableHead>
                <TableHead>{t("table.status")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {letters.map((letter) => (
                <TableRow key={letter.id}>
                  <TableCell dir="ltr" className="font-mono text-xs">{letter.eventType}</TableCell>
                  <TableCell
                    className="max-w-[28ch] truncate text-xs text-[var(--t2)]"
                    title={letter.lastError}
                  >
                    {letter.lastError}
                  </TableCell>
                  <TableCell>{letter.attempts}</TableCell>
                  <TableCell className="text-xs text-[var(--t3)]">
                    {formatDate(letter.failedAt, { withTime: true })}
                  </TableCell>
                  <TableCell>
                    {letter.replayedAt ? (
                      <Badge variant="secondary">{t("replayed")}</Badge>
                    ) : (
                      <Badge variant="destructive">{t("failed")}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {!letter.replayedAt && (
                      <ConfirmDialog
                        title={t("confirmTitle")}
                        description={t("confirmDescription")}
                        confirmLabel={t("replay")}
                        destructive={false}
                        pending={replayMutation.isPending}
                        onConfirm={() => replayMutation.mutate({ id: letter.id })}
                      >
                        <Button size="sm" variant="outline" disabled={replayMutation.isPending}>
                          {t("replay")}
                        </Button>
                      </ConfirmDialog>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
