import { cn } from "@/lib/utils";

const Input = ({
  className,
  type,
  ref,
  ...props
}: React.ComponentProps<"input"> & { ref?: React.Ref<HTMLInputElement> }) => {
  return (
    <input
      type={type}
      className={cn(
        "flex min-h-11 w-full rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text-primary)] shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
};
Input.displayName = "Input";

export { Input };
