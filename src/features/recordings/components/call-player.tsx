"use client";

import { Pause, Play } from "lucide-react";
import { useRef, useState } from "react";
import { formatClock } from "@/modules/recordings/validation";

/** A call recording: play or pause, drag to a moment, and the time. Nothing loads until Play. */
export function CallPlayer({ recordingId, seconds, label }: { recordingId: string; seconds: number | null; label: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(seconds ?? 0);
  const [failed, setFailed] = useState(false);
  const max = Math.max(1, Math.floor(length));
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => setFailed(true));
    else el.pause();
  };
  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={`${playing ? "Pause" : "Play"} ${label}`}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-hairline hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
        >
          {playing ? <Pause aria-hidden="true" className="size-4 fill-current" /> : <Play aria-hidden="true" className="size-4 translate-x-px fill-current" />}
        </button>
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={Math.min(at, max)}
          aria-label={`Position in ${label}`}
          aria-valuetext={formatClock(Math.floor(at))}
          onChange={(e) => {
            const to = Number(e.target.value);
            setAt(to);
            if (audio.current) audio.current.currentTime = to;
          }}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-brand"
        />
        <span className="shrink-0 text-[11px] font-bold text-zinc-600 tabular-nums">
          {formatClock(Math.floor(at))} / {formatClock(Math.floor(length))}
        </span>
      </div>
      {failed ? (
        <p role="alert" className="mt-1.5 text-[11px] font-semibold text-rose-600">
          The recording could not be played.
        </p>
      ) : null}
      <audio
        ref={audio}
        preload="none"
        src={`/api/v1/recordings/${recordingId}`}
        onPlay={() => {
          // One call at a time.
          document.querySelectorAll("audio").forEach((other) => other !== audio.current && other.pause());
          setFailed(false);
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setAt(0)}
        onError={() => setFailed(true)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLength(e.currentTarget.duration)}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
      />
    </div>
  );
}
