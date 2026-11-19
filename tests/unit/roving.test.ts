// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { bindRoving } from "../../src/ui/roving";

const press = (el: HTMLElement, key: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));

describe("bindRoving", () => {
  let group: HTMLElement;
  let buttons: HTMLButtonElement[];
  let selected: string[];

  beforeEach(() => {
    document.body.innerHTML = `<div><button>One</button><button tabindex="-1">Two</button><button tabindex="-1">Three</button></div>`;
    group = document.querySelector("div")!;
    buttons = [...group.querySelectorAll("button")];
    selected = [];
    bindRoving(group, { items: () => buttons, select: (b) => selected.push(b.textContent!) });
    buttons[0].focus();
  });

  it("moves with Left and Right, wrapping at the ends, and selects as it goes", () => {
    press(buttons[0], "ArrowRight");
    expect(document.activeElement).toBe(buttons[1]);
    press(buttons[1], "ArrowLeft");
    press(buttons[0], "ArrowLeft");
    expect(document.activeElement).toBe(buttons[2]);
    expect(selected).toEqual(["Two", "One", "Three"]);
  });

  it("reaches the ends with Home and End", () => {
    press(buttons[0], "End");
    expect(document.activeElement).toBe(buttons[2]);
    press(buttons[2], "Home");
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("keeps one Tab stop, with no tabindex on a button so a Mac still reaches it with Option-Tab", () => {
    press(buttons[0], "ArrowRight");
    expect(buttons.map((b) => b.getAttribute("tabindex"))).toEqual(["-1", null, "-1"]);
  });

  it("leaves shortcuts and other keys alone", () => {
    expect(press(buttons[0], "ArrowRight", { metaKey: true })).toBe(true);
    expect(press(buttons[0], "ArrowDown")).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });
});
