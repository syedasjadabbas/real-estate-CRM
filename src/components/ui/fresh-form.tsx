"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";

/**
 * Starts a "create" form empty every time its page is opened again (owner, 14 Nov 2026).
 *
 * With Cache Components, Next.js keeps a visited page in the background (React Activity) so going back
 * is instant, and its form state survived: a new task, lead or booking opened with the previous one's
 * values and errors still filled in. Effects are cleaned up when the page is hidden, so the key moves
 * on then, and the form remounts with its initial values the next time the page is shown.
 */
export function FreshForm({ children }: { children: ReactNode }) {
  const [visit, setVisit] = useState(0);
  useEffect(() => () => setVisit((n) => n + 1), []);
  return <Fragment key={visit}>{children}</Fragment>;
}
