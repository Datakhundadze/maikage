// Footsteps of a shoe on a tiled floor, synthesised with the Web Audio API
// (no audio files).
//
// Each footfall: heel strike = a short low sine dropping in pitch (the body)
// plus a hard band-passed noise click, then ~80 ms later the toe = a softer
// click and a scuff. Left and right feet differ slightly in pitch, and every
// step varies a little in level, pitch and timing so the rhythm doesn't
// sound mechanical.
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
  out.connect(ctx.destination);

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

      // a shoe on a tiled floor: heel strike (body thud + hard click), then the
      // toe rolling down a moment later (softer click + scuff)
      const thud = (t: number, gain: number) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f * 1.8, t);
        osc.frequency.exponentialRampToValueAtTime(f, t + 0.04);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + 0.13);
      };
      const click = (t: number, centreHz: number, q: number, gain: number, decay: number) => {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.playbackRate.value = 0.9 + Math.random() * 0.2;
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = centreHz * tune;
        bp.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        src.connect(bp).connect(g).connect(out);
        src.start(t, Math.random() * 0.05);
        src.stop(t + decay + 0.02);
      };
      thud(t0, 0.75 * s);
      click(t0, 2400, 1.4, 0.55 * s, 0.035); // heel on tile
      click(t0 + 0.002, 900, 0.9, 0.25 * s, 0.06); // body of the impact
      const toe = t0 + 0.075 + Math.random() * 0.02;
      click(toe, 3200, 1.8, 0.28 * s, 0.03); // toe
      click(toe + 0.01, 1600, 0.7, 0.12 * s, 0.09); // sole scuff
    },
    resume: () => ctx.resume(),
    suspend: () => ctx.suspend(),
    close: () => ctx.close(),
  };
}
