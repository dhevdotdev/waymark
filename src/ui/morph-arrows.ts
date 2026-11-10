import { reducedMotion } from "./media";

export type ArrowsShape = "apart" | "together";

const SVG_NS = "http://www.w3.org/2000/svg";
const STIFFNESS = 420;
const DAMPING = 30;
const LONGEST_STEP_S = 1 / 120;

/** Two diagonal arrows as polylines. Both shapes have the same points in the same order, so each point has a partner to travel to. */
const SHAPES: Record<ArrowsShape, number[][]> = {
  apart: [
    [9.5, 2.5, 13.5, 2.5, 13.5, 6.5],
    [13.5, 2.5, 9, 7],
    [2.5, 13.5, 7, 9],
    [6.5, 13.5, 2.5, 13.5, 2.5, 9.5],
  ],
  together: [
    [13.3, 6.7, 9.3, 6.7, 9.3, 2.7],
    [13.8, 2.2, 9.3, 6.7],
    [2.2, 13.8, 6.7, 9.3],
    [2.7, 9.3, 6.7, 9.3, 6.7, 13.3],
  ],
};

const drawn = (lines: number[][]) =>
  lines
    .map((line) => {
      const pairs: string[] = [];
      for (let i = 0; i < line.length; i += 2) pairs.push(`${line[i].toFixed(2)} ${line[i + 1].toFixed(2)}`);
      return `M${pairs.join("L")}`;
    })
    .join("");

/** An icon of two arrows that springs between pointing apart and pointing together, and can be turned around mid-flight. */
export class MorphArrows {
  readonly svg = document.createElementNS(SVG_NS, "svg");
  private readonly path = document.createElementNS(SVG_NS, "path");
  private target: ArrowsShape;
  private from: number[][];
  private shown: number[][];
  private progress = 1;
  private speed = 0;
  private frame = 0;
  private lastTime = -1;

  constructor(shape: ArrowsShape) {
    this.target = shape;
    this.from = this.shown = SHAPES[shape];
    this.svg.setAttribute("viewBox", "0 0 16 16");
    this.svg.setAttribute("aria-hidden", "true");
    this.svg.append(this.path);
    this.path.setAttribute("d", drawn(this.shown));
  }

  snap(shape: ArrowsShape): void {
    this.stop();
    this.target = shape;
    this.from = this.shown = SHAPES[shape];
    this.progress = 1;
    this.speed = 0;
    this.path.setAttribute("d", drawn(this.shown));
  }

  to(shape: ArrowsShape): void {
    if (shape === this.target) return;
    if (reducedMotion()) {
      this.snap(shape);
      return;
    }
    this.target = shape;
    this.from = this.shown;
    this.progress = 0;
    this.lastTime = -1;
    if (!this.frame) this.frame = requestAnimationFrame((now) => this.tick(now));
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private tick(now: number): void {
    let left = this.lastTime < 0 ? LONGEST_STEP_S : Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    while (left > 0) {
      const step = Math.min(left, LONGEST_STEP_S);
      this.speed += ((1 - this.progress) * STIFFNESS - this.speed * DAMPING) * step;
      this.progress += this.speed * step;
      left -= step;
    }
    const settled = Math.abs(1 - this.progress) < 0.002 && Math.abs(this.speed) < 0.02;
    const goal = SHAPES[this.target];
    this.shown = settled
      ? goal
      : this.from.map((line, l) => line.map((value, i) => value + (goal[l][i] - value) * this.progress));
    this.path.setAttribute("d", drawn(this.shown));
    if (settled) {
      this.progress = 1;
      this.speed = 0;
      this.frame = 0;
    } else this.frame = requestAnimationFrame((next) => this.tick(next));
  }
}
