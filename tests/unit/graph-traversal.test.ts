import { describe, expect, it } from "vitest";
import { traversalOrder } from "../../src/ui/graph-traversal";

const node = (id: string, group: number, x: number, y: number) => ({ id, group, x, y });

describe("traversalOrder", () => {
  it("visits the largest community first and loose notes last", () => {
    const order = traversalOrder([
      node("loose", -1, 0, 0),
      node("small", 2, 50, 50),
      node("big-a", 1, 10, 0),
      node("big-b", 1, -10, 0),
    ]);
    expect(
      order
        .map((n) => n.id)
        .slice(0, 2)
        .sort(),
    ).toEqual(["big-a", "big-b"]);
    expect(order.map((n) => n.id).slice(2)).toEqual(["small", "loose"]);
  });

  it("walks around a community rather than jumping across it", () => {
    const ring = [node("east", 0, 10, 0), node("west", 0, -10, 0), node("south", 0, 0, 10), node("north", 0, 0, -10)];
    expect(traversalOrder(ring).map((n) => n.id)).toEqual(["north", "east", "south", "west"]);
  });

  it("includes every note exactly once", () => {
    const nodes = Array.from({ length: 40 }, (_, i) => node(String(i), i % 4, Math.cos(i) * i, Math.sin(i) * i));
    expect(new Set(traversalOrder(nodes)).size).toBe(40);
  });

  it("is empty for no notes", () => {
    expect(traversalOrder([])).toEqual([]);
  });
});
