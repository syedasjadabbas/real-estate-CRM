import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const fieldBase =
  "w-full rounded-xl border border-zinc-200/80 bg-zinc-50/70 text-sm font-medium text-zinc-900 shadow-hairline transition-colors placeholder:text-zinc-400 hover:border-zinc-300 focus:border-brand/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-60";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Optional leading icon (e.g. search). */
  leading?: ReactNode;
  /** Optional trailing element (e.g. keyboard hint). */
  trailing?: ReactNode;
  invalid?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { leading, trailing, invalid, className, ...props },
  ref,
) {
  if (!leading && !trailing) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(fieldBase, "h-10 px-3", invalid && "border-rose-300 ring-rose-100", className)}
        {...props}
      />
    );
  }
  return (
    <div
      className={cn(
        fieldBase,
        "flex h-10 items-center gap-2 px-3 focus-within:border-brand/50 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand/15",
        invalid && "border-rose-300",
        className,
      )}
    >
      {leading ? <span className="flex shrink-0 text-zinc-400">{leading}</span> : null}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className="min-w-0 flex-1 bg-transparent text-sm font-medium text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
        {...props}
      />
      {trailing}
    </div>
  );
});

/** Keyboard shortcut hint ("/") shown at the end of the sidebar search. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-200/80 bg-white px-1.5 py-0.5 font-sans text-[10px] leading-[14px] font-bold text-zinc-400 shadow-hairline">
      {children}
    </kbd>
  );
}

/** Label + control + hint/error wrapper. */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={id}
        className="block text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase"
      >
        {label}
        {required ? <span className="text-rose-600"> *</span> : null}
      </label>
      {children(id, describedBy)}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-semibold text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-zinc-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
