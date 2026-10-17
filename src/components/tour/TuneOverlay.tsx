import { useEffect, useState } from "react";
import { getNode, TOUR_NODES, type TourNodeId } from "@/lib/tour/tourConfig";
import { angleDiff, round1 } from "@/lib/tour/tourMath";

// Tuning aid, shown only with /showroom?tune=1. Displays where the view
// points (world yaw/pitch, and the yaw inside the photo — handy for
// northOffsetDeg) and copies a link snippet for tourConfig.ts:
//   {"from":"s3","to":"s4","yawDeg":-89.4,"pitchDeg":-32}
// for the point under the screen centre (the crosshair). The node picker
// jumps straight to any node.

export interface TunePose {
  node: TourNodeId;
  yawDeg: number;
  pitchDeg: number;
  /** Yaw inside the photo at the screen centre (0 = image centre), if known. */
  photoYawDeg: number | null;
}

interface TuneOverlayProps {
  pose: TunePose | null;
  onPickNode: (id: TourNodeId) => void;
}

export default function TuneOverlay({ pose, onPickNode }: TuneOverlayProps) {
  const node = pose ? getNode(pose.node) : null;
  const links = node?.links ?? [];
  // default target: the link closest to where we look
  const nearest = pose
    ? [...links].sort((a, b) => Math.abs(angleDiff(a.yawDeg, pose.yawDeg)) - Math.abs(angleDiff(b.yawDeg, pose.yawDeg)))[0]?.to
    : undefined;
  const [to, setTo] = useState<TourNodeId | "">("");
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => setTo(""), [pose?.node]);
  const target = to || nearest || "";

  const snippet =
    pose && target
      ? JSON.stringify({ from: pose.node, to: target, yawDeg: round1(pose.yawDeg), pitchDeg: round1(pose.pitchDeg) })
      : "";

  const copy = async () => {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied("დაკოპირდა");
    } catch {
      setCopied("ვერ დაკოპირდა — მონიშნეთ ტექსტი ხელით");
    }
    window.setTimeout(() => setCopied(null), 2000);
  };

  return (
    <>
      {/* crosshair: the point the snippet describes */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 h-6 w-6 -translate-x-1/2 -translate-y-1/2" aria-hidden>
        <div className="absolute left-1/2 top-0 h-full w-px bg-amber-400" />
        <div className="absolute left-0 top-1/2 h-px w-full bg-amber-400" />
      </div>
      <div className="absolute left-3 top-3 z-20 w-64 space-y-2 rounded-lg p-3 font-mono text-xs text-white" style={{ background: "rgba(0,0,0,.75)" }}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-sans font-semibold">tune</span>
          <select
            aria-label="წერტილის არჩევა"
            className="rounded bg-white/15 px-1 py-0.5"
            value={pose?.node ?? ""}
            onChange={(e) => onPickNode(e.target.value as TourNodeId)}
          >
            {TOUR_NODES.map((n) => (
              <option key={n.id} value={n.id} className="text-black">
                {n.id}
              </option>
            ))}
          </select>
        </div>
        {pose ? (
          <dl className="grid gap-x-2" style={{ gridTemplateColumns: "auto 1fr", rowGap: 2 }}>
            <dt>node</dt>
            <dd>{pose.node}</dd>
            <dt>yaw</dt>
            <dd>{round1(pose.yawDeg)}° world</dd>
            <dt>pitch</dt>
            <dd>{round1(pose.pitchDeg)}°</dd>
            <dt>photo</dt>
            <dd>{pose.photoYawDeg === null ? "—" : `${round1(pose.photoYawDeg)}° (north ${round1(node?.northOffsetDeg ?? 0)}°)`}</dd>
          </dl>
        ) : (
          <p>…</p>
        )}
        <div className="flex items-center gap-2">
          <label className="font-sans" htmlFor="tune-to">
            to
          </label>
          <select id="tune-to" className="rounded bg-white/15 px-1 py-0.5" value={target} onChange={(e) => setTo(e.target.value as TourNodeId)}>
            {links.map((l) => (
              <option key={l.to} value={l.to} className="text-black">
                {l.to}
              </option>
            ))}
          </select>
          <button type="button" onClick={copy} disabled={!snippet} className="rounded bg-amber-400 px-2 py-1 font-sans font-semibold text-black disabled:opacity-50">
            copy link here
          </button>
        </div>
        {snippet && (
          <p className="break-all text-[11px] text-white/80" style={{ userSelect: "all" }}>
            {snippet}
          </p>
        )}
        {copied && (
          <p className="font-sans" style={{ color: "#fcd34d" }}>
            {copied}
          </p>
        )}
      </div>
    </>
  );
}
