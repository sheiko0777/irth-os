import { cn } from "@/lib/utils";

/**
 * glass: the default, a translucent card over the lit canvas.
 * solid: an opaque surface, for dense tables and forms.
 * hero: the one navy headline surface per screen (a balance, the day's sales).
 */
const CARD_VARIANTS = {
  glass: "glass text-[var(--text-primary)]",
  solid:
    "border border-[var(--separator)] bg-[var(--surface)] text-[var(--text-primary)] shadow-[var(--card-shadow)]",
  hero: "surface-hero",
} as const;

const Card = ({
  className,
  ref,
  variant = "glass",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
  variant?: keyof typeof CARD_VARIANTS;
}) => (
  <div
    ref={ref}
    className={cn(
      "rounded-[var(--card-radius)]",
      CARD_VARIANTS[variant],
      className,
    )}
    {...props}
  />
);
Card.displayName = "Card";

const CardHeader = ({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
}) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
);
CardHeader.displayName = "CardHeader";

const CardTitle = ({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
}) => (
  <div
    ref={ref}
    className={cn("font-semibold leading-none tracking-tight", className)}
    {...props}
  />
);
CardTitle.displayName = "CardTitle";

const CardDescription = ({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
}) => (
  <div
    ref={ref}
    className={cn("text-sm text-[var(--text-secondary)]", className)}
    {...props}
  />
);
CardDescription.displayName = "CardDescription";

const CardContent = ({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
}) => <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />;
CardContent.displayName = "CardContent";

const CardFooter = ({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
}) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
);
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};
