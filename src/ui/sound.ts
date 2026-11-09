/**
 * A small synthesised palette for deliberate actions and meaningful events,
 * plus the optional click of a mechanical switch while writing. Nothing plays
 * for routine clicks, scrolling or background fetches, and the same cue never
 * stacks within its cooldown.
 */
export type Cue = "copy" | "open" | "synced" | "incoming" | "problem" | "commit" | "pushed";
export type Keystroke = "key" | "space" | "return" | "delete";

interface SwitchSound {
  /** The bright snap of the switch, in Hz. */
  click: number;
  /** The low knock of the key bottoming out, in Hz. */
  body: number;
  decay: number;
  gain: number;
}

const SWITCHES: Record<Keystroke, SwitchSound> = {
  key: { click: 3400, body: 190, decay: 0.035, gain: 0.1 },
  delete: { click: 2800, body: 160, decay: 0.04, gain: 0.1 },
  space: { click: 1900, body: 120, decay: 0.06, gain: 0.12 },
  return: { click: 2300, body: 130, decay: 0.055, gain: 0.13 },
};

/** Which key sound a press makes, or null for one that writes nothing. Held keys repeat silently, as a real switch does. */
export function keystrokeOf(e: Pick<KeyboardEvent, "key" | "repeat" | "metaKey" | "ctrlKey" | "isComposing">): Keystroke | null {
  if (e.repeat || e.metaKey || e.ctrlKey || e.isComposing) return null;
  if (e.key === " ") return "space";
  if (e.key === "Enter") return "return";
  if (e.key === "Backspace" || e.key === "Delete") return "delete";
  return e.key.length === 1 ? "key" : null;
}

interface Note {
  f: number;
  t: number;
  d: number;
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
    env.gain.linearRampToValueAtTime(1, t0 + n.t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d);
    osc.connect(env).connect(out);
    osc.start(t0 + n.t);
    osc.stop(t0 + n.t + n.d + 0.02);
    end = Math.max(end, t0 + n.t + n.d + 0.02);
  }
  return end;
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseFor(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.1), ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

/** A filtered burst of noise for the snap and a falling tone for the knock, varied a little so no two presses match. */
function strike(ctx: BaseAudioContext, stroke: Keystroke, t0: number): void {
  const { click, body, decay, gain } = SWITCHES[stroke];
  const vary = () => 0.92 + Math.random() * 0.16;
  const out = ctx.createGain();
  out.gain.value = gain * vary();
  out.connect(ctx.destination);

  const noise = ctx.createBufferSource();
  noise.buffer = noiseFor(ctx);
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = click * vary();
  band.Q.value = 1.4;
  const snap = ctx.createGain();
  snap.gain.setValueAtTime(1, t0);
  snap.gain.exponentialRampToValueAtTime(0.001, t0 + decay * 0.6);
  noise.connect(band).connect(snap).connect(out);
  noise.start(t0);
  noise.stop(t0 + decay);

  const knock = ctx.createOscillator();
  knock.type = "triangle";
  knock.frequency.setValueAtTime(body * vary(), t0);
  knock.frequency.exponentialRampToValueAtTime(body * 0.5, t0 + decay);
  const fall = ctx.createGain();
  fall.gain.setValueAtTime(0.9, t0);
  fall.gain.exponentialRampToValueAtTime(0.001, t0 + decay);
  knock.connect(fall).connect(out);
  knock.start(t0);
  knock.stop(t0 + decay + 0.01);
}

export class Sound {
  private ctx: AudioContext | null = null;
  private last = new Map<Cue, number>();

  /** Observer for tests and recordings; called whenever a cue is played (not when muted or cooling down). */
  onPlay: ((sound: Cue | Keystroke) => void) | null = null;

  constructor(public muted: boolean) {}

  /** Plays a key press on the speakers, or on `target` when rendering one offline. */
  keystroke(stroke: Keystroke, target?: BaseAudioContext): void {
    if (this.muted) return;
    this.onPlay?.(stroke);
    try {
      this.ctx ??= new AudioContext();
      const ctx = target ?? this.ctx;
      if (ctx === this.ctx && ctx.state === "suspended") void this.ctx.resume();
      strike(ctx, stroke, ctx.currentTime);
    } catch {
      /* Audio is optional; a blocked or missing output device never affects writing. */
    }
  }

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
