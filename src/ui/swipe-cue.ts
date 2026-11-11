import { icons } from "./icons";
import { reducedMotion } from "./media";

export type Step = -1 | 1;
type Side = "back" | "forward";

/**
 * Spring rate, per second, while fingers move. Critically damped, it trails a steady swipe by
 * 2 / FOLLOW, about 33 ms: two frames, enough to merge uneven wheel events into one motion
 * while still reading as attached to the fingers.
 */
const FOLLOW = 60;
/** Slower return when a swipe stops short, so the way back reads as travel rather than a snap. */
const RETURN = 26;
/** Pixels from outside its edge to where it rests in the gutter. */
const TRAVEL = 30;
const COMMIT_MS = 380;
/** Reduce Motion's fade, matching --t-exit. */
const FADE_MS = 140;
/** Commit phases as fractions of COMMIT_MS: settle at rest, hold there, then retreat. */
const SETTLED = 0.3;
const RETREAT = 0.45;
const PULSE = 0.08;
const SAMPLES = 24;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const easeOut = (n: number): number => 1 - (1 - n) ** 3;
/** Share of the travel covered at a progress; it slows towards the threshold, as if pulled against something. */
const reach = (p: number): number => 1 - (1 - clamp01(p)) ** 2;

/** Progress, scale and fill opacity through a commit, from where the cue was when the swipe crossed. */
function commitFrame(from: number, u: number): { p: number; scale: number; fill: number } {
  let p = 1;
  if (u < SETTLED) p = from + (1 - from) * easeOut(u / SETTLED);
  else if (u > RETREAT) p = 1 - easeOut((u - RETREAT) / (1 - RETREAT));
  const scale = u < RETREAT ? 1 + PULSE * Math.sin((Math.PI * u) / RETREAT) ** 2 : 1;
  return { p, scale, fill: easeOut(clamp01(u / 0.2)) };
}

/** One arrow, fixed to one edge, presented from a spring that chases the swipe's progress. */
class Cue {
  readonly el = document.createElement("div");
  private readonly fill = document.createElement("div");
  private readonly edge: number;
  private goal = 0;
  private rate = FOLLOW;
  private p = 0;
  private v = 0;
  private frame = 0;
  private last = 0;
  private exit: { anims: Animation[]; from: number; still: boolean } | null = null;

  constructor(host: HTMLElement, side: Side) {
    this.edge = side === "back" ? -1 : 1;
    this.el.className = "swipe-cue";
    this.el.dataset.side = side;
    this.el.setAttribute("aria-hidden", "true");
    this.fill.className = "swipe-cue-fill";
    this.el.innerHTML = icons[side];
    this.fill.innerHTML = icons[side];
    this.el.append(this.fill);
    host.append(this.el);
  }

  follow(progress: number): void {
    this.interruptExit();
    this.el.classList.add("is-on");
    this.el.classList.toggle("is-ready", progress >= 1);
    this.el.dataset.progress = progress.toFixed(3);
    this.aim(progress, FOLLOW);
  }

  /** Returns to its edge carrying whatever speed it had, and fades on the way. */
  withdraw(): void {
    if (this.exit) return;
    this.el.classList.remove("is-on", "is-ready");
    this.el.dataset.progress = "0";
    this.aim(0, RETURN);
  }

  /** Settles at rest, fills with a small pulse, then retreats into its edge. Runs on the compositor, so it keeps going while the next note renders. */
  commit(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const still = reducedMotion();
    const from = still ? this.p : clamp01(this.p);
    const keys: Keyframe[] = [];
    const fillKeys: Keyframe[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const u = i / SAMPLES;
      const f = commitFrame(from, u);
      if (still) {
        const o = u < 0.2 ? from + (1 - from) * (u / 0.2) : u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
        keys.push({ offset: u, opacity: o });
      } else {
        keys.push({ offset: u, opacity: reach(f.p), transform: this.transformAt(f.p, f.scale) });
      }
      fillKeys.push({ offset: u, opacity: f.fill });
    }
    const timing: KeyframeAnimationOptions = { duration: COMMIT_MS, easing: "linear", fill: "forwards" };
    const anims = [this.el.animate(keys, timing), this.fill.animate(fillKeys, timing)];
    this.exit = { anims, from, still };
    anims[0].onfinish = () => {
      if (this.exit?.anims !== anims) return;
      this.exit = null;
      this.p = 0;
      this.v = 0;
      this.goal = 0;
      this.el.classList.remove("is-on", "is-ready");
      this.el.dataset.progress = "0";
      this.clearPresentation();
      for (const a of anims) a.cancel();
    };
  }

  private transformAt(p: number, scale = 1): string {
    const x = (1 - reach(p)) * TRAVEL * this.edge;
    return scale === 1 ? `translateX(${x.toFixed(2)}px)` : `translateX(${x.toFixed(2)}px) scale(${scale.toFixed(4)})`;
  }

  /** A swipe during the exit picks the cue up where the exit had it, moving as it was. */
  private interruptExit(): void {
    if (!this.exit) return;
    const { anims, from, still } = this.exit;
    const u = clamp01(Number(anims[0].currentTime ?? 0) / COMMIT_MS);
    this.exit = null;
    if (still) {
      this.p = Number(getComputedStyle(this.el).opacity);
      this.v = 0;
    } else {
      const du = 0.01;
      const a = commitFrame(from, Math.max(0, u - du)).p;
      const b = commitFrame(from, Math.min(1, u + du)).p;
      this.p = commitFrame(from, u).p;
      this.v = ((b - a) / (2 * du)) * (1000 / COMMIT_MS);
    }
    this.fill.style.opacity = String(commitFrame(from, u).fill);
    for (const anim of anims) anim.cancel();
    this.present();
    requestAnimationFrame(() => {
      this.fill.style.opacity = "";
    });
  }

  private aim(goal: number, rate: number): void {
    this.goal = goal;
    this.rate = rate;
    if (this.frame !== 0) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (reducedMotion()) this.fadeStep(dt);
    else this.springStep(dt);
    const settled = Math.abs(this.p - this.target) < 0.002 && Math.abs(this.v) < 0.02;
    if (settled) {
      this.p = this.target;
      this.v = 0;
    }
    this.present();
    this.frame = settled ? 0 : requestAnimationFrame(this.tick);
  };

  /** Under Reduce Motion the cue does not track; it fades in whole while the swipe is on. */
  private get target(): number {
    return reducedMotion() ? (this.goal > 0 ? 1 : 0) : this.goal;
  }

  private springStep(dt: number): void {
    const w = this.rate;
    const x = this.p - this.goal;
    const c = this.v + w * x;
    const decay = Math.exp(-w * dt);
    this.p = this.goal + (x + c * dt) * decay;
    this.v = (c - w * (x + c * dt)) * decay;
  }

  private fadeStep(dt: number): void {
    const room = this.target - this.p;
    const step = (dt * 1000) / FADE_MS;
    this.p += Math.sign(room) * Math.min(Math.abs(room), step);
    this.v = 0;
  }

  private present(): void {
    if (this.p <= 0 && this.goal === 0) {
      this.clearPresentation();
      return;
    }
    if (reducedMotion()) {
      this.el.style.opacity = this.p.toFixed(3);
      this.el.style.transform = "";
      return;
    }
    this.el.style.opacity = reach(this.p).toFixed(3);
    this.el.style.transform = this.transformAt(this.p);
  }

  private clearPresentation(): void {
    this.el.style.opacity = "";
    this.el.style.transform = "";
  }
}

/** The arrows at the edges of the note area that track a swipe and fill when it navigates. */
export class SwipeCue {
  private readonly cues: Record<Side, Cue>;

  constructor(host: HTMLElement) {
    this.cues = { back: new Cue(host, "back"), forward: new Cue(host, "forward") };
  }

  track(step: Step, progress: number): void {
    const side: Side = step < 0 ? "back" : "forward";
    this.cues[side === "back" ? "forward" : "back"].withdraw();
    this.cues[side].follow(progress);
  }

  cancel(): void {
    this.cues.back.withdraw();
    this.cues.forward.withdraw();
  }

  commit(step: Step): void {
    this.cues[step < 0 ? "back" : "forward"].commit();
  }
}
