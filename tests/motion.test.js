import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const script = await readFile(
  new URL("../public/motion.js", import.meta.url),
  "utf8",
);

function element() {
  const listeners = new Map();
  const properties = new Map();
  return {
    listeners,
    properties,
    style: { setProperty: (name, value) => properties.set(name, value) },
    addEventListener: (name, listener) => listeners.set(name, listener),
    matches: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  };
}

function openPage() {
  const scene = element();
  const go = element();
  const logo = element();
  go.parentElement = go;
  runInNewContext(script, {
    document: {
      querySelector: (selector) =>
        ({ ".scene": scene, ".go": go, ".logo-wrap": logo })[selector],
      addEventListener() {},
    },
    matchMedia: (query) => ({
      matches: query.includes("pointer: fine"),
      addEventListener() {},
    }),
    cancelAnimationFrame() {},
  });
  return { go, logo };
}

for (const name of ["go", "logo"]) {
  test(`${name} 的键盘聚焦恢复右上方向，不沿用先前鼠标的进入方向`, () => {
    const target = openPage()[name];
    target.listeners.get("pointerenter")({
      clientX: 0,
      clientY: 100,
      pointerType: "mouse",
    });
    assert.ok(parseFloat(target.properties.get("--hover-x")) < 0);
    assert.ok(parseFloat(target.properties.get("--hover-y")) > 0);
    target.listeners.get("focus")?.();
    assert.ok(parseFloat(target.properties.get("--hover-x")) > 0);
    assert.ok(parseFloat(target.properties.get("--hover-y")) < 0);
  });
}
