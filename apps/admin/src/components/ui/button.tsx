import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--control-radius)] text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--accent)] text-[var(--accent-fg)] shadow-[0_8px_18px_-10px_var(--accent)] hover:bg-[var(--accent-strong)]",
        destructive:
          "border border-[var(--critical)] bg-[var(--critical-bg)] text-[var(--critical)] shadow-sm hover:opacity-90",
        outline:
          "border border-[var(--separator)] bg-[var(--glass-strong)] text-[var(--text-primary)] hover:border-[var(--input-border)] hover:bg-[var(--surface)]",
        secondary:
          "bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--raised)]",
        ghost: "text-[var(--text-primary)] hover:bg-[var(--accent-soft)]",
        link: "text-[var(--accent)] underline-offset-4 hover:underline",
      },
      size: {
        default: "px-4 py-2",
        sm: "px-3 py-2 text-xs",
        lg: "px-8 py-2",
        icon: "min-w-11 px-0 py-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
