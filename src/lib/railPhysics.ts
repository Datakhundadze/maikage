// Showroom-rail physics: every garment on the rail is a body with
//   - a damped pendulum around its hook (swing angle `th`, degrees),
//   - an underdamped spring for the side → front turn (`p`: 0 side, 1 front;
//     it overshoots a little past "facing you" and settles),
//   - a vertical settle used for the entrance drop (`y`, px).
// One shared requestAnimationFrame loop advances every awake body and sleeps
// when they are all at rest. Ported from the rail prototype.
//
// Bodies render themselves (`render(t)` writes transforms to the DOM and must
// not read layout); this module only integrates. onWake/onSleep fire when a
// body starts/stops moving (e.g. to set will-change only while it animates).
// With reduced motion, wake() snaps a body to its target and kick() does
// nothing, so nothing animates.

export interface RailBody {
  /** Turn: position (0 side … 1 front), velocity, target. */
  p: number;
  pv: number;
  pt: number;
  /** Swing: angle (deg) and angular velocity. */
  th: number;
  tv: number;
  /** Entrance drop: offset (px) and velocity. */
  y: number;
  yv: number;
  /** Until this time (performance.now) the body is held hidden (staggered drop). */
  hold: number;
  /** Pendulum stiffness and damping. */
  k: number;
  c: number;
  /** Turn spring stiffness and damping. */
  ks: number;
  kd: number;
  /** Set when the body's element is gone; pending kicks are dropped. */
  dead?: boolean;
  render: (t: number) => void;
  /** Called when the body starts moving / comes to rest. */
  onWake?: () => void;
  onSleep?: () => void;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

let reducedMotion = false;
/** Turn animation off (prefers-reduced-motion): changes apply instantly. */
export function setRailReducedMotion(reduce: boolean): void {
  reducedMotion = reduce;
}

const live = new Set<RailBody>();
let running = false;
let lastT = 0;

function tick(t: number): void {
  const dt = Math.min((t - lastT) / 1000, 1 / 30);
  lastT = t;
  for (const b of live) {
    if (b.dead) {
      live.delete(b);
      b.onSleep?.();
      continue;
    }
    if (b.hold && t < b.hold) {
      b.render(t);
      continue;
    }
    b.hold = 0;
    // turn: underdamped spring → slight overshoot past "facing you", then settles
    const pa = (b.pt - b.p) * b.ks - b.pv * b.kd;
    b.pv += pa * dt;
    b.p += b.pv * dt;
    // swing: pendulum around the hook
    const ta = -b.k * b.th - b.c * b.tv;
    b.tv += ta * dt;
    b.th += b.tv * dt;
    // vertical settle (entrance drop)
    const ya = -170 * b.y - 15 * b.yv;
    b.yv += ya * dt;
    b.y += b.yv * dt;
    b.render(t);
    if (
      Math.abs(b.pt - b.p) < 0.0015 &&
      Math.abs(b.pv) < 0.002 &&
      Math.abs(b.th) < 0.02 &&
      Math.abs(b.tv) < 0.03 &&
      Math.abs(b.y) < 0.05 &&
      Math.abs(b.yv) < 0.05
    ) {
      b.p = b.pt;
      b.pv = b.th = b.tv = b.y = b.yv = 0;
      b.render(t);
      live.delete(b);
      b.onSleep?.();
    }
  }
  if (live.size) requestAnimationFrame(tick);
  else running = false;
}

/** Start (or keep) integrating this body until it comes to rest. */
export function wake(b: RailBody): void {
  if (b.dead) return;
  if (reducedMotion) {
    b.p = b.pt;
    b.pv = b.th = b.tv = b.y = b.yv = 0;
    b.hold = 0;
    b.render(performance.now());
    return;
  }
  if (!live.has(b)) {
    live.add(b);
    b.onWake?.();
  }
  if (!running) {
    running = true;
    lastT = performance.now();
    requestAnimationFrame(tick);
  }
}

/** Push the body's swing by `deg` deg/s, optionally after `delay` ms. */
export function kick(b: RailBody | undefined | null, deg: number, delay = 0): void {
  if (reducedMotion || !b) return;
  const go = () => {
    if (b.dead) return;
    b.tv = clamp(b.tv + deg, -90, 90);
    wake(b);
  };
  if (delay) setTimeout(go, delay);
  else go();
}

/** Stop a body for good (its element is being removed). */
export function release(b: RailBody): void {
  b.dead = true;
  if (live.delete(b)) b.onSleep?.();
}

/** A body at rest, with slightly randomised pendulum constants so a rail never swings in lockstep. */
export function mkBody(extra: Partial<RailBody> & { render: (t: number) => void }): RailBody {
  return {
    p: 0,
    pv: 0,
    pt: 0,
    th: 0,
    tv: 0,
    y: 0,
    yv: 0,
    hold: 0,
    k: 38 * (0.85 + Math.random() * 0.3),
    c: 2.6 * (0.85 + Math.random() * 0.3),
    ks: 150,
    kd: 15,
    ...extra,
  };
}
