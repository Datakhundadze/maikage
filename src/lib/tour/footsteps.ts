// Soft footstep thuds, synthesised with the Web Audio API (no audio files).
//
// Each footfall is a short low sine that drops in pitch (the body of the
// thud) plus a quiet low-passed noise tick (the shoe on the floor). Left and
// right feet differ slightly in pitch so the rhythm doesn't sound mechanical.
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

const THUD_SECONDS = 0.16;

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
      const t = ctx.currentTime + 0.005;
      const s = Math.min(1, Math.max(0.35, strength));
      const f = cfg.pitchHz * (foot === "left" ? 1 - cfg.pitchSpread / 2 : 1 + cfg.pitchSpread / 2);

      // body: low sine sliding down
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f * 1.6, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      const body = ctx.createGain();
      body.gain.setValueAtTime(0.0001, t);
      body.gain.exponentialRampToValueAtTime(s, t + 0.006);
      body.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(body).connect(out);
      osc.start(t);
      osc.stop(t + THUD_SECONDS);

      // contact: muffled noise tick
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = f * 6;
      const tick = ctx.createGain();
      tick.gain.setValueAtTime(0.0001, t);
      tick.gain.exponentialRampToValueAtTime(0.35 * s, t + 0.004);
      tick.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      src.connect(lp).connect(tick).connect(out);
      src.start(t);
      src.stop(t + THUD_SECONDS);
    },
    resume: () => ctx.resume(),
    suspend: () => ctx.suspend(),
    close: () => ctx.close(),
  };
}
