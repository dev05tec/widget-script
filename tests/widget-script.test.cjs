const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { JSDOM } = require("jsdom");

const source = readFileSync(require.resolve("../widget-script.js"), "utf8");
const integrity = source.match(/const TIFLUX_SCRIPT_INTEGRITY = "([^"]+)"/)[1];
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function setup(t, { ready = "complete", open, layout } = {}) {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "https://customer.example/", runScripts: "outside-only", pretendToBeVisual: true,
  });
  const w = dom.window;
  t.after(() => w.close());
  const d = w.document;
  Object.defineProperty(d, "readyState", { value: ready, configurable: true });

  const script = d.createElement("script");
  script.dataset.token = "configured-token";
  if (open !== undefined) script.dataset.open = open;
  if (layout !== undefined) script.dataset.layout = layout;
  Object.defineProperty(d, "currentScript", { value: script });

  const errors = [];
  w.console.error = (...args) => errors.push(args.join(" "));
  const nativeScript = d.createElement("script");
  nativeScript.src = "https://public-assets.tiflux.com/widget/tiflux-widget.iife.js";
  nativeScript.integrity = integrity;
  nativeScript.crossOrigin = "anonymous";
  d.head.append(nativeScript);
  let initializedWith;
  w.TifluxWidget = { init: (config) => { initializedWith = config; } };

  w.eval(source);
  if (ready === "loading") d.dispatchEvent(new w.Event("DOMContentLoaded"));
  await flush();
  return { w, d, errors, get initializedWith() { return initializedWith; } };
}

test("initializes the native widget after DOMContentLoaded", async (t) => {
  const s = await setup(t, { ready: "loading" });
  assert.equal(s.w.__SecullumWidget.initialized, true);
  assert.equal(s.initializedWith.token, "configured-token");
  assert.deepEqual(s.errors, []);
});

test("applies the configured token and default widget offsets", async (t) => {
  const s = await setup(t);
  assert.equal(s.initializedWith.token, "configured-token");
  assert.equal(s.initializedWith.xOffset, 24);
  assert.equal(s.w.__SecullumWidget.initialized, true);
});

test("rejects an already loaded script with an unexpected integrity value", async (t) => {
  const s = await setup(t);
  const tag = s.d.querySelector('script[src="https://public-assets.tiflux.com/widget/tiflux-widget.iife.js"]');
  tag.integrity = "sha384-unexpected";
  s.w.__SecullumWidget.initialized = false;
  s.w.TifluxWidget = { init() { throw new Error("must not initialize"); } };
  s.w.__SecullumWidget = undefined;
  s.w.eval(source);
  await flush();
  assert.equal(s.w.__SecullumWidget, undefined);
  assert.ok(s.errors.some((message) => message.includes("integridade esperada")));
});
