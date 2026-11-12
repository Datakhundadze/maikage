// Footsteps of a shoe on a tiled floor, synthesised with the Web Audio API
// (no audio files).
//
// Each footfall is a SOFT one — a sneaker, not a hard heel (David 2026-11-12:
// "the footsteps are very harsh"): the heel = a low sine with a gentle start
// plus a dull pat of low-passed noise, then ~90 ms later the toe = a quieter
// pat and a short brush of the sole. No bright clicks: everything also goes
// through one low-pass, so nothing above ~1.6 kHz is left. Left and right
// feet differ slightly in pitch, and every step varies a little in level,
// pitch and timing so the rhythm doesn't sound mechanical.
//
// The AudioContext is created by createFootsteps(), which the viewer calls
// only from the user's own tap on the sound button (browsers require a
// gesture anyway).

export interface FootstepConfig {
  /** Master volume, 0…1 (peak gain of one thud). Keep it low. */
  volume: number;
  /** Base pitch of the thud, Hz. */
  pitchHz: number;
  /** Relative pitch difference between left and right foot (0.06 = 6 %). */
  pitchSpread: number;
}

export interface Footsteps {
  /** Play one thud; `strength` 0…1 scales the volume (e.g. walking speed). */
  play(foot: "left" | "right", strength?: number): void;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
  readonly state: AudioContextState;
}

const THUD_SECONDS = 0.3;

export function createFootsteps(cfg: FootstepConfig): Footsteps | null {
  const Ctx: typeof AudioContext | undefined =
    window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return null;
  }

  // One shared noise buffer, reused for every step.
  const noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * THUD_SECONDS), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const out = ctx.createGain();
  out.gain.value = cfg.volume;
  // the whole step through one low-pass: takes the edge off whatever is left
  const soften = ctx.createBiquadFilter();
  soften.type = "lowpass";
  soften.frequency.value = 1600;
  soften.Q.value = 0.5;
  out.connect(soften).connect(ctx.destination);

  return {
    get state() {
      return ctx.state;
    },
    play(foot, strength = 1) {
      if (ctx.state !== "running") return;
      const t0 = ctx.currentTime + 0.005;
      const s = Math.min(1, Math.max(0.35, strength)) * (0.85 + Math.random() * 0.3);
      const tune = (foot === "left" ? 1 - cfg.pitchSpread / 2 : 1 + cfg.pitchSpread / 2) * (0.96 + Math.random() * 0.08);
      const f = cfg.pitchHz * tune;

      // a soft sole on a tiled floor: the heel lands (low body + dull pat),
      // then the toe rolls down a moment later (quieter pat + a brush)
      const thud = (t: number, gain: number) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f * 1.35, t);
        osc.frequency.exponentialRampToValueAtTime(f, t + 0.06);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + 0.18);
      };
      // a pat: noise with its top cut off, a soft start and a short tail
      const pat = (t: number, cutHz: number, gain: number, attack: number, decay: number) => {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.playbackRate.value = 0.8 + Math.random() * 0.2;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = cutHz * tune;
        lp.Q.value = 0.6;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        src.connect(lp).connect(g).connect(out);
        src.start(t, Math.random() * 0.05);
        src.stop(t + decay + 0.02);
      };
      thud(t0, 0.5 * s);
      pat(t0, 650, 0.3 * s, 0.008, 0.09); // heel
      const toe = t0 + 0.085 + Math.random() * 0.025;
      pat(toe, 900, 0.14 * s, 0.01, 0.07); // toe
      pat(toe + 0.01, 1300, 0.05 * s, 0.02, 0.12); // the sole's brush
    },
    resume: () => ctx.resume(),
    suspend: () => ctx.suspend(),
    close: () => ctx.close(),
  };
}
