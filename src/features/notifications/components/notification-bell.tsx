"use client";

import { Bell, Check, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

type Item = { id: string; type: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };
type Feed = { unread: number; rows: Item[] };

/** Polling interval (SYSTEM_ARCHITECTURE.md: 30–60 s polling). */
const POLL_MS = 45_000;
const SHOWN_KEY = "mz-shown-follow-up-reminders";
/** Dispatched on `window` by other notification controls so the bell refreshes without waiting for a poll. */
export const NOTIFICATIONS_CHANGED = "mz:notifications-changed";

const timeOf = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Karachi" }).format(new Date(iso));

function readShown(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(SHOWN_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/**
 * Header bell (FR-006): unread count, the latest notifications, mark read, and a pop-up for each
 * new "follow-up soon" reminder (shown once per browser session).
 */
export function NotificationBell() {
  const router = useRouter();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState<Item | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const { data } = (await res.json()) as { data: Feed };
      setFeed(data);
      const shown = readShown();
      const next = data.rows.find((r) => r.type === "follow_up_soon" && !r.readAt && !shown.includes(r.id));
      if (next) {
        setPopup(next);
        try {
          sessionStorage.setItem(SHOWN_KEY, JSON.stringify([...shown, next.id].slice(-200)));
        } catch {
          // storage unavailable: the pop-up may show again after a reload
        }
      }
    } catch {
      // offline or signed out: keep the last state
    }
  }, []);

  useEffect(() => {
    // First load right after mount, then poll; state is only set from these callbacks.
    const first = setTimeout(load, 0);
    const timer = setInterval(load, POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    window.addEventListener(NOTIFICATIONS_CHANGED, onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openItem = async (item: Item) => {
    setOpen(false);
    setPopup((p) => (p?.id === item.id ? null : p));
    if (!item.readAt) await fetch(`/api/v1/notifications/${item.id}/read`, { method: "POST" }).catch(() => null);
    void load();
    if (item.link) router.push(item.link);
  };

  const readAll = async () => {
    await fetch("/api/v1/notifications/read-all", { method: "POST" }).catch(() => null);
    void load();
  };

  const unread = feed?.unread ?? 0;
  const rows = feed?.rows.slice(0, 10) ?? [];

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((o) => !o);
          void load();
        }}
        className="relative inline-flex size-9 items-center justify-center rounded-xl border border-zinc-200/80 bg-white text-zinc-700 shadow-hairline hover:bg-zinc-50"
      >
        <Bell aria-hidden="true" className="size-[18px]" />
        {unread > 0 ? (
          <span className="absolute -top-1.5 -right-1.5 min-w-5 rounded-full bg-rose-600 px-1 text-center text-[10px] leading-5 font-black text-white tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          // Phones: pinned inside the viewport (the bell isn't at the screen edge); wider screens: under the bell.
          className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-lg sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[360px]"
        >
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <p className="text-sm font-black">Notifications</p>
            {unread > 0 ? (
              <button type="button" onClick={readAll} className="inline-flex items-center gap-1 text-[11px] font-bold text-brand hover:underline">
                <Check aria-hidden="true" className="size-3.5" />
                Mark all read
              </button>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs font-semibold text-zinc-500">{feed ? "No notifications yet." : "Loading…"}</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-zinc-100 overflow-y-auto">
              {rows.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => openItem(n)} className={cn("flex w-full gap-2.5 px-4 py-3 text-left hover:bg-zinc-50", !n.readAt && "bg-brand-50/40")}>
                    <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand")} />
                    <span className="min-w-0">
                      <span className="block text-xs font-bold break-words text-zinc-900">{n.title}</span>
                      {n.body ? <span className="mt-0.5 block text-[11px] break-words text-zinc-600">{n.body}</span> : null}
                      <span className="mt-0.5 block text-[10px] text-zinc-400">
                        {timeOf(n.createdAt)}
                        {n.readAt ? "" : " · unread"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link href="/dashboard/notifications" onClick={() => setOpen(false)} className="block border-t border-zinc-100 px-4 py-2.5 text-center text-xs font-bold text-brand hover:bg-zinc-50">
            View all
          </Link>
        </div>
      ) : null}

      {popup ? (
        <div role="alert" className="fixed right-3 bottom-3 z-[60] w-[min(340px,calc(100vw-24px))] rounded-2xl border border-amber-200 bg-white p-4 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] font-black tracking-[0.1em] text-amber-700 uppercase">Follow-up soon</p>
            <button type="button" aria-label="Dismiss" onClick={() => setPopup(null)} className="-m-1 rounded-lg p-1 text-zinc-500 hover:bg-zinc-100">
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
          <p className="mt-1 text-sm font-bold break-words text-zinc-900">{popup.title.replace(/^Follow-up soon · /, "")}</p>
          {popup.body ? <p className="mt-0.5 text-xs break-words text-zinc-600">{popup.body}</p> : null}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => openItem(popup)} className="rounded-xl bg-brand px-3 py-1.5 text-xs font-bold text-white shadow-hairline">
              View
            </button>
            <Link href="/dashboard/notifications" onClick={() => setPopup(null)} className="rounded-xl border border-zinc-200/80 px-3 py-1.5 text-xs font-bold text-zinc-700 hover:bg-zinc-50">
              All
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
