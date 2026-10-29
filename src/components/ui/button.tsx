import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "soft" | "ghost";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  // Selected chip / primary action: solid brand green.
  primary: "bg-brand text-white shadow-hairline hover:bg-brand-700",
  // White bordered control (header "Log out", toolbar buttons).
  secondary:
    "border border-zinc-200/80 bg-white text-zinc-800 shadow-hairline hover:bg-zinc-50",
  // Light filled control ("View all →").
  soft: "border border-zinc-200/80 bg-zinc-50 text-zinc-800 shadow-hairline hover:bg-zinc-100",
  // Unselected chip.
  ghost: "text-zinc-700 hover:bg-zinc-100",
};

const sizes: Record<Size, string> = {
  sm: "h-7 gap-1.5 rounded-xl px-2.5 text-[11px]",
  md: "h-9 gap-1.5 rounded-xl px-3 text-xs",
  lg: "h-10 gap-2 rounded-xl px-4 text-sm",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const buttonClasses = ({
  variant = "secondary",
  size = "md",
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}) =>
  cn(
    "inline-flex shrink-0 items-center justify-center font-bold whitespace-nowrap transition-colors",
    "disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    sizes[size],
    className,
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, className, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClasses({ variant, size, className })} {...props} />;
});

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Accessible name — icon buttons have no visible text. */
  label: string;
  size?: "md" | "lg";
};

/** Square bordered icon button (header menu toggle, notifications). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "lg", className, type = "button", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-xl border border-zinc-200/80 bg-white text-zinc-700 shadow-hairline transition-colors hover:bg-zinc-50",
        size === "lg" ? "size-10" : "size-9",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
