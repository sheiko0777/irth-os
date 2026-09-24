"use client";

import { AlertCircle, CheckCircle2, Info, MinusCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

type SectionStatusValue =
  | "loaded"
  | "not_applicable"
  | "not_exposed_by_provider"
  | "permission_denied"
  | "fetch_failed";

interface SectionStatusProps {
  status: SectionStatusValue;
  reason?: string;
  action?: { label: string; onClick?: () => void; href?: string };
}

const statusStyles = {
  loaded: {
    icon: CheckCircle2,
    className:
      "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]",
  },
  not_applicable: {
    icon: MinusCircle,
    className:
      "border-[var(--separator)] bg-[var(--raised)] text-[var(--text-secondary)]",
  },
  not_exposed_by_provider: {
    icon: Info,
    className: "border-[var(--info)] bg-[var(--info-bg)] text-[var(--info)]",
  },
  permission_denied: {
    icon: AlertCircle,
    className:
      "border-[var(--critical)] bg-[var(--critical-bg)] text-[var(--critical)]",
  },
  fetch_failed: {
    icon: AlertCircle,
    className:
      "border-[var(--critical)] bg-[var(--critical-bg)] text-[var(--critical)]",
  },
} satisfies Record<
  SectionStatusValue,
  { icon: typeof AlertCircle; className: string }
>;

export function SectionStatus({ status, reason, action }: SectionStatusProps) {
  const t = useTranslations("sectionStatus");
  const config = statusStyles[status];
  const Icon = config.icon;
  const actionClassName =
    "inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

  return (
    <div
      data-testid="section-status"
      data-status={status}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3 text-sm",
        config.className,
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t(status)}</p>
        {reason && (
          <p className="mt-0.5 text-[var(--text-secondary)]">{reason}</p>
        )}
      </div>
      {action?.href ? (
        <a
          href={action.href}
          onClick={action.onClick}
          className={actionClassName}
        >
          {action.label}
        </a>
      ) : action ? (
        <button
          type="button"
          onClick={action.onClick}
          className={actionClassName}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
