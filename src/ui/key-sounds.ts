import clickyUrl from "../assets/key-sounds/clicky.wav?url";
import linearUrl from "../assets/key-sounds/linear.wav?url";
import strokes from "../assets/key-sounds/strokes.json";
import tactileUrl from "../assets/key-sounds/tactile.wav?url";
import type { KeyVolume, SwitchProfile } from "../prefs";

export type Family = "key" | "space" | "enter" | "backspace" | "modifier";
type Direction = "down" | "up";

const URLS: Record<SwitchProfile, string> = { linear: linearUrl, tactile: tactileUrl, clicky: clickyUrl };
/* The loudest recorded stroke peaks at 0.87, and panning passes at most 0.93 of it, so 1.2 cannot clip. */
const LEVELS: Record<KeyVolume, number> = { soft: 0.4, medium: 0.75, loud: 1.2 };
const MODIFIERS = /^(?:Shift|Control|Alt|Meta|CapsLock|Tab|Fn)/;
const STEREO_WIDTH = 0.55;
const RELEASE_LEVEL = 0.8;
/** A key's spring takes a moment to carry the cap back up after the finger lets go. */
const RELEASE_DELAY_S = 0.008;
const FASTEST_GAP_MS = 70;
const SLOWEST_GAP_MS = 220;
const FASTEST_TOUCH = 0.6;
const DECODE_SAMPLE_RATE = 44100;

/** A MacBook keyboard, row by row, so each key sounds from where it sits. */
const ROWS = [
  "Backquote Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal Backspace",
  "Tab KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight Backslash",
  "CapsLock KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote Enter",
  "ShiftLeft KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash ShiftRight",
  "ControlLeft AltLeft MetaLeft Space MetaRight AltRight ArrowLeft ArrowUp ArrowRight",
].map((row) => row.split(" "));

const PHRASE = "KeyT KeyH KeyO KeyC KeyK Space KeyT KeyA KeyP Enter".split(" ");
const PHRASE_GAP_S = 0.11;
const PHRASE_HOLD_S = 0.06;

export function familyOf(code: string): Family {
  if (code === "Space") return "space";
  if (code === "Enter" || code === "NumpadEnter") return "enter";
  if (code === "Backspace" || code === "Delete") return "backspace";
  return MODIFIERS.test(code) ? "modifier" : "key";
}

/** Where a key sits from left (-1) to right (1). Keys off the main block sound from the middle. */
export function keyPan(code: string): number {
  if (code === "Space") return 0;
  const row = ROWS.find((keys) => keys.includes(code));
  if (!row) return 0;
  return (row.indexOf(code) / (row.length - 1)) * 2 - 1;
}

/** Each key's own slight tuning, the same every time it is pressed. */
export function keyTune(code: string): number {
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = (hash * 31 + code.charCodeAt(i)) % 1000;
  return 0.98 + (hash / 1000) * 0.04;
}

/** How hard a press lands. Fast fingers barely bottom out, so quick typing is softer than a deliberate press. */
export function touchFor(gapMs: number): number {
  const position = Math.min(1, Math.max(0, (gapMs - FASTEST_GAP_MS) / (SLOWEST_GAP_MS - FASTEST_GAP_MS)));
  return FASTEST_TOUCH + (1 - FASTEST_TOUCH) * position;
}

interface Held {
  family: Family;
  stroke: number;
  touch: number;
}

/** Recorded mechanical switches: a press and its own release, from where each key sits on the board. */
export class KeySounds {
  private readonly buffers = new Map<SwitchProfile, Promise<AudioBuffer | null>>();
  private readonly decoded = new Map<SwitchProfile, AudioBuffer>();
  private readonly held = new Map<string, Held>();
  private readonly lastStroke = new Map<Family, number>();
  private lastPress = 0;
  private profile: SwitchProfile = "tactile";
  private volume: KeyVolume = "medium";

  /** Observer for tests. */
  onStrike: ((sound: string) => void) | null = null;

  constructor(private readonly audio: () => BaseAudioContext | null) {}

  use(profile: SwitchProfile, volume: KeyVolume): void {
    this.profile = profile;
    this.volume = volume;
  }

  /** Fetches and decodes a profile so its first key press is already instant. */
  load(profile: SwitchProfile): Promise<boolean> {
    let buffer = this.buffers.get(profile);
    if (!buffer) {
      buffer = fetch(URLS[profile])
        .then((response) => response.arrayBuffer())
        .then((bytes) => new OfflineAudioContext(1, 1, DECODE_SAMPLE_RATE).decodeAudioData(bytes))
        .catch((error: unknown) => {
          console.warn("Key sounds not loaded", error);
          this.buffers.delete(profile);
          return null;
        });
      this.buffers.set(profile, buffer);
    }
    return buffer.then((decoded) => {
      if (decoded) this.decoded.set(profile, decoded);
      return decoded !== null;
    });
  }

  /** Holding a key repeats silently after the first press, as a real switch does. */
  press(code: string, repeat = false): void {
    if (repeat) return;
    const now = performance.now();
    const held = this.newStroke(familyOf(code), touchFor(now - this.lastPress));
    this.lastPress = now;
    if (this.strike(code, held, "down", 0)) this.held.set(code, held);
  }

  /** A key released with no press heard stays silent. */
  release(code: string): void {
    const held = this.held.get(code);
    if (!held) return;
    this.held.delete(code);
    this.strike(code, held, "up", RELEASE_DELAY_S);
  }

  forgetHeld(): void {
    this.held.clear();
  }

  /** Types a few keys so a switch can be judged the moment it is picked. */
  async preview(profile: SwitchProfile, volume: KeyVolume): Promise<void> {
    this.use(profile, volume);
    if (!(await this.load(profile))) return;
    PHRASE.forEach((code, i) => {
      const held = this.newStroke(familyOf(code), 1);
      this.strike(code, held, "down", i * PHRASE_GAP_S);
      this.strike(code, held, "up", i * PHRASE_GAP_S + PHRASE_HOLD_S);
    });
  }

  private newStroke(family: Family, touch: number): Held {
    const count = strokes[this.profile][family].down.length;
    const last = this.lastStroke.get(family);
    let stroke = Math.floor(Math.random() * count);
    if (stroke === last) stroke = (stroke + 1) % count;
    this.lastStroke.set(family, stroke);
    return { family, stroke, touch };
  }

  private strike(code: string, { family, stroke, touch }: Held, direction: Direction, delay: number): boolean {
    const ctx = this.audio();
    const buffer = this.decoded.get(this.profile);
    if (!ctx || !buffer) return false;
    this.onStrike?.(`${family}-${direction}`);
    const [start, duration] = strokes[this.profile][family][direction][stroke];
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = keyTune(code) * (0.99 + Math.random() * 0.02);
    const gain = ctx.createGain();
    gain.gain.value = LEVELS[this.volume] * touch * (direction === "up" ? RELEASE_LEVEL : 1) * (0.92 + Math.random() * 0.08);
    const panner = ctx.createStereoPanner();
    panner.pan.value = keyPan(code) * STEREO_WIDTH;
    source.connect(gain).connect(panner).connect(ctx.destination);
    source.start(ctx.currentTime + delay, start, duration);
    return true;
  }
}
