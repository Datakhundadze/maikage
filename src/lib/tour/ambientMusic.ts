// Quiet background music for the /showroom walk: a soft electronic loop,
// generated live with the Web Audio API (no audio file, nothing to license).
//
// 100 BPM, four chords of two bars each (Am9 – Fmaj7 – Cmaj9 – G6), played
// by a warm detuned pad, a round sub bass on the beat, a gentle plucked
// arpeggio in 8ths with a little echo, a soft kick on 1 and 3 and a quiet
// off-beat hi-hat. Everything goes through a low-pass "room" and a
// compressor, at a low master level under the footsteps.
//
// Like the footsteps, the AudioContext is created only from a user gesture
// (the sound button / first joystick touch); browsers require that anyway.

export interface AmbientMusic {
  start(): Promise<void>;
  stop(): Promise<void>;
  close(): Promise<void>;
}

const BPM = 100;
const BEAT = 60 / BPM;
const BAR = 4 * BEAT;
// chord tones as MIDI notes (root first)
const CHORDS: number[][] = [
  [45, 57, 60, 64, 67, 71], // Am9:   A2 | A3 C4 E4 G4 B4
  [41, 57, 60, 64, 65, 69], // Fmaj7: F2 | A3 C4 E4 F4 A4
  [48, 55, 60, 62, 64, 71], // Cmaj9: C3 | G3 C4 D4 E4 B4
  [43, 55, 59, 62, 64, 67], // G6:    G2 | G3 B3 D4 E4 G4
];
const ARP = [1, 3, 2, 4, 3, 5, 4, 2]; // indexes into the chord, one per 8th

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export function createAmbientMusic(volume = 0.05): AmbientMusic | null {
  const Ctx: typeof AudioContext | undefined =
    window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return null;
  }

  const master = ctx.createGain();
  master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.ratio.value = 3;
  const room = ctx.createBiquadFilter();
  room.type = "lowpass";
  room.frequency.value = 5200;
  room.connect(comp).connect(master).connect(ctx.destination);

  // echo for the arpeggio
  const delay = ctx.createDelay(1);
  delay.delayTime.value = BEAT * 0.75;
  const fb = ctx.createGain();
  fb.gain.value = 0.32;
  const delayLp = ctx.createBiquadFilter();
  delayLp.type = "lowpass";
  delayLp.frequency.value = 2200;
  delay.connect(delayLp).connect(fb).connect(delay);
  delayLp.connect(room);

  const noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.2), ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const pad = (chord: number[], t: number, len: number) => {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1300, t + len * 0.5);
    lp.frequency.linearRampToValueAtTime(700, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11, t + 1.2);
    g.gain.setValueAtTime(0.11, t + len - 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.8);
    lp.connect(g).connect(room);
    for (const n of chord.slice(1, 5)) {
      for (const detune of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = hz(n);
        o.detune.value = detune;
        const og = ctx.createGain();
        og.gain.value = 0.18;
        o.connect(og).connect(lp);
        o.start(t);
        o.stop(t + len + 0.9);
      }
    }
  };
  const bass = (midi: number, t: number) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = hz(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + BEAT * 0.9);
    o.connect(g).connect(room);
    o.start(t);
    o.stop(t + BEAT);
  };
  const pluck = (midi: number, t: number) => {
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = hz(midi + 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g);
    g.connect(room);
    g.connect(delay);
    o.start(t);
    o.stop(t + 0.4);
  };
  const kick = (t: number) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(room);
    o.start(t);
    o.stop(t + 0.3);
  };
  const hat = (t: number, gain: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(hp).connect(g).connect(room);
    src.start(t);
    src.stop(t + 0.07);
  };

  // look-ahead scheduler: every 25 ms, schedule what falls in the next 150 ms
  let timer = 0;
  let next8th = 0; // index of the next 8th note to schedule
  let startAt = 0;
  const schedule = () => {
    const until = ctx.currentTime + 0.15;
    for (;;) {
      const t = startAt + next8th * (BEAT / 2);
      if (t >= until) break;
      const bar = Math.floor(next8th / 8);
      const inBar = next8th % 8;
      const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
      if (bar % 2 === 0 && inBar === 0) pad(chord, t, 2 * BAR);
      if (inBar % 2 === 0) bass(chord[0], t);
      if (inBar === 0 || inBar === 4) kick(t);
      hat(t, inBar % 2 === 1 ? 0.05 : 0.018);
      // arpeggio from the 3rd bar on, so the music eases in
      if (next8th >= 16) pluck(chord[ARP[inBar]], t);
      next8th++;
    }
  };

  let running = false;
  return {
    async start() {
      if (running) return;
      running = true;
      await ctx.resume().catch(() => {});
      startAt = ctx.currentTime + 0.1;
      next8th = 0;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0, ctx.currentTime);
      master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 3);
      schedule();
      timer = window.setInterval(schedule, 25);
    },
    async stop() {
      if (!running) return;
      running = false;
      window.clearInterval(timer);
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
      await new Promise((r) => window.setTimeout(r, 450));
      if (!running) await ctx.suspend().catch(() => {});
    },
    async close() {
      running = false;
      window.clearInterval(timer);
      await ctx.close().catch(() => {});
    },
  };
}
