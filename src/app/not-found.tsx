import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

/** Unknown addresses, and records that don't exist or aren't visible to this user. */
export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-zinc-50 p-4">
      <div className="max-w-md rounded-2xl border border-zinc-200/80 bg-white px-6 py-10 text-center shadow-hairline">
        <h1 className="text-base font-black text-zinc-900">Page not found</h1>
        <p className="mt-1 text-sm text-zinc-600">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
        <Link href="/dashboard" className={buttonClasses({ variant: "primary", size: "lg", className: "mt-4" })}>
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
