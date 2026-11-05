"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonClasses } from "@/components/ui/button";

/** Shown inside the app shell when a page fails. It gives no error details: those go to the server log. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="rounded-2xl border border-zinc-200/80 bg-white px-6 py-10 text-center shadow-hairline">
      <h2 className="text-base font-black text-zinc-900">Something went wrong</h2>
      <p className="mt-1 text-sm text-zinc-600">This page could not be loaded. Your saved work is not affected.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button variant="primary" size="lg" onClick={() => retry()}>
          Try again
        </Button>
        <Link href="/dashboard" className={buttonClasses({ variant: "secondary", size: "lg" })}>
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
