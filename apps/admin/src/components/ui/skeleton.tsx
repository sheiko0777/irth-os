import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-[var(--rim1)]', className)}
      {...props}
    />
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[var(--rim1)] bg-[var(--card-bg)] p-5 space-y-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-[var(--rim1)]">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-4 w-20 ms-auto" />
      <Skeleton className="h-5 w-16 rounded-full" />
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

export { Skeleton, SkeletonCard, SkeletonRow };
