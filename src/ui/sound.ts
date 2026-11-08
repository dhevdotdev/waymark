/**
 * A small synthesised palette for deliberate actions and meaningful events.
 * Nothing plays for routine clicks, typing, scrolling or background fetches,
 * and the same cue never stacks within its cooldown.
 */
export type Cue = "copy" | "open" | "synced" | "incoming" | "problem" | "commit" | "pushed";

interface Note {
  f: number;
  t: number;
  d: number;
  g?: number;
}

const CUES: Record<Cue, { notes: Note[]; type: OscillatorType; gain: number }> = {
  copy: {
    type: "sine",
    gain: 0.05,
    notes: [
      { f: 1568, t: 0, d: 0.06 },
      { f: 2093, t: 0.04, d: 0.09 },
    ],
  },
  open: {
    type: "sine",
    gain: 0.035,
    notes: [
      { f: 880, t: 0, d: 0.09 },
      { f: 1318.5, t: 0.05, d: 0.14 },
    ],
  },
  synced: {
    type: "sine",
    gain: 0.05,
    notes: [
      { f: 659.3, t: 0, d: 0.12 },
      { f: 987.8, t: 0.08, d: 0.22 },
    ],
  },
  incoming: {
    type: "triangle",
    gain: 0.045,
    notes: [
      { f: 523.3, t: 0, d: 0.1 },
      { f: 659.3, t: 0.07, d: 0.1 },
      { f: 784, t: 0.14, d: 0.22 },
    ],
  },
  problem: {
    type: "triangle",
    gain: 0.05,
    notes: [
      { f: 392, t: 0, d: 0.14 },
      { f: 311.1, t: 0.1, d: 0.24 },
    ],
  },
  commit: {
    type: "sine",
    gain: 0.05,
    notes: [
      { f: 587.3, t: 0, d: 0.08 },
      { f: 880, t: 0.06, d: 0.18 },
    ],
  },
  pushed: {
    type: "sine",
    gain: 0.05,
    notes: [
      { f: 784, t: 0, d: 0.08 },
      { f: 1174.7, t: 0.06, d: 0.1 },
      { f: 1568, t: 0.12, d: 0.24 },
    ],
  },
};

const COOLDOWN_MS = 900;

/** Schedules one cue's notes on any audio context, live or offline. */
function schedule(ctx: BaseAudioContext, destination: AudioNode, cue: Cue, t0: number): number {
  const spec = CUES[cue];
  const out = ctx.createGain();
  out.gain.value = spec.gain;
  out.connect(destination);
  let end = t0;
  for (const n of spec.notes) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = spec.type;
    osc.frequency.value = n.f;
    env.gain.setValueAtTime(0, t0 + n.t);
    env.gain.linearRampToValueAtTime(n.g ?? 1, t0 + n.t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d);
    osc.connect(env).connect(out);
    osc.start(t0 + n.t);
    osc.stop(t0 + n.t + n.d + 0.02);
    end = Math.max(end, t0 + n.t + n.d + 0.02);
  }
  return end;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private last = new Map<Cue, number>();

  /** Observer for tests and recordings; called whenever a cue is played (not when muted or cooling down). */
  onPlay: ((cue: Cue) => void) | null = null;

  constructor(public muted: boolean) {}

  play(cue: Cue): void {
    if (this.muted) return;
    const now = performance.now();
    if (now - (this.last.get(cue) ?? -Infinity) < COOLDOWN_MS) return;
    this.last.set(cue, now);
    this.onPlay?.(cue);
    try {
      this.ctx ??= new AudioContext();
      const ctx = this.ctx;
      if (ctx.state === "suspended") void ctx.resume();
      schedule(ctx, ctx.destination, cue, ctx.currentTime + 0.01);
    } catch {
      /* Audio is optional; a blocked or missing output device never affects reading. */
    }
  }
}
