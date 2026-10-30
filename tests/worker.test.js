import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

function installCache(t, cache) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "caches");
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "caches", previous);
    else delete globalThis.caches;
  });
  globalThis.caches = { default: cache };
}

for (const elapsed of [7000, 31000]) {
  test(`Worker 对耗时 ${elapsed / 1000} 秒的快照仅缓存剩余有效期`, async (t) => {
    let clock = Date.parse("2026-10-13T02:00:00Z");
    const websiteId = "11111111-2222-3333-4444-555555555555";
    t.mock.method(Date, "now", () => clock);
    t.mock.method(globalThis, "fetch", async (url) => {
      if (String(url).includes("/api/share/")) {
        clock += elapsed;
        return Response.json({ websiteId, token: "test-token", shareType: 1 });
      }
      return Response.json({ visitors: 1, pageviews: 2 });
    });
    const stored = [];
    installCache(t, {
      match: async () => undefined,
      put: async (key, response) => stored.push({ key, response }),
    });
    const { default: isolatedWorker } = await import(`../src/index.js?slow=${elapsed}`);
    const pending = [];
    const response = await isolatedWorker.fetch(
      new Request("https://site.test/api/traffic"),
      { UMAMI_SHARE_URL: "https://analytics.test/share/test" },
      { waitUntil: (promise) => pending.push(promise) },
    );
    await Promise.all(pending);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(stored.length, elapsed < 30000 ? 1 : 0);
    if (stored.length) assert.equal(stored[0].response.headers.get("Cache-Control"), "public, max-age=23");
  });
}

test("Worker 切换分享配置时不复用边缘缓存，缓存键不包含分享链接", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-10-13T02:00:00Z"));
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    if (String(url).includes("/api/share/")) return Response.json({
      websiteId: "11111111-2222-3333-4444-555555555555",
      token: String(url).endsWith("private-site-a") ? "a" : "b",
      shareType: 1,
    });
    const visitors = options.headers["x-umami-share-token"] === "a" ? 1 : 10;
    return Response.json({ visitors, pageviews: visitors });
  });
  const entries = new Map();
  installCache(t, {
    match: async (key) => entries.get(key.url)?.clone(),
    put: async (key, response) => entries.set(key.url, response.clone()),
  });
  const { default: isolatedWorker } = await import("../src/index.js?config-switch");
  const read = async (site) => {
    const pending = [];
    const response = await isolatedWorker.fetch(
      new Request("https://site.test/api/traffic"),
      { UMAMI_SHARE_URL: `https://analytics.test/share/private-site-${site}` },
      { waitUntil: (promise) => pending.push(promise) },
    );
    await Promise.all(pending);
    return response.json();
  };
  assert.equal((await read("a")).online, 1);
  assert.equal((await read("a")).online, 1);
  assert.equal(calls, 4);
  assert.equal((await read("b")).online, 10);
  assert.equal(calls, 8);
  assert.ok([...entries.keys()].every((key) => !key.includes("private-site") && !key.includes("analytics.test")));
});

test("未配置统计时返回无缓存的明确失败，不代理任意查询 URL", async () => {
  const response = await worker.fetch(
    new Request("https://site.test/api/traffic?url=https://other.test"),
    {},
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { error: "访问统计暂不可用" });
});

test("统计接口只接受 GET", async () => {
  const response = await worker.fetch(
    new Request("https://site.test/api/traffic", { method: "POST" }),
    {},
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET");
});

test("页面和静态资源仍转交 ASSETS", async () => {
  for (const path of ["/", "/styles.css", "/motion.js", "/traffic.js"]) {
    const request = new Request(`https://site.test${path}`);
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch(received) {
          assert.equal(received, request);
          return new Response("asset");
        },
      },
    });
    assert.equal(await response.text(), "asset");
  }
});
