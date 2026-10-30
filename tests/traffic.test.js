import assert from "node:assert/strict";
import test from "node:test";
import { createTrafficService } from "../src/traffic.js";

const websiteId = "ee3cbb93-6ca4-4164-8a6c-4bb22b80675d";
const shareURL = "https://umami.amoe.cc/share/test-share/site";

for (const failed of [false, true]) {
  test(`昨日请求晚到${failed ? "失败" : "成功"}不覆盖今日缓存`, async () => {
    const fake = upstream();
    let clock = Date.parse("2026-10-13T15:59:59.500Z");
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let first = true;
    const load = createTrafficService({ now: () => clock, fetcher: async (...args) => {
      if (first) {
        first = false;
        await gate;
        if (failed) throw new Error("old request failed");
      }
      return fake.fetcher(...args);
    } });
    const yesterday = load(shareURL);
    // 立即处理可能的拒绝，避免测试本身产生 unhandled rejection。
    const oldResult = yesterday.catch(() => undefined);
    clock += 1000;
    const today = await load(shareURL);
    release();
    await oldResult;
    const before = fake.calls.length;
    assert.deepEqual(await load(shareURL), today);
    assert.equal(fake.calls.length, before);
  });
}

test("慢查询的缓存期限从快照开始时刻计算", async () => {
  const fake = upstream();
  let clock = Date.parse("2026-10-13T02:00:00Z");
  const load = createTrafficService({ now: () => clock, fetcher: async (...args) => {
    if (String(args[0]).includes("/api/share/")) clock += 7000;
    return fake.fetcher(...args);
  } });
  const initial = await load(shareURL);
  clock = Date.parse(initial.updatedAt) + 36000;
  const refreshed = await load(shareURL);
  assert.notEqual(refreshed.updatedAt, initial.updatedAt);
  assert.equal(fake.calls.length, 8);
});

function upstream({
  legacy = false,
  fail = false,
  wrongSite = false,
  siteId = websiteId,
} = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, options });
    if (fail) return new Response("private upstream failure", { status: 500 });
    if (parsed.pathname.startsWith("/api/share/")) {
      return Response.json({
        websiteId: wrongSite ? "other-site" : siteId,
        token: "private-token",
        shareType: 1,
      });
    }
    assert.equal(options.headers["x-umami-share-token"], "private-token");
    assert.equal(options.headers["x-umami-share-context"], "1");
    assert.equal(options.headers.Cookie, undefined);
    if (parsed.pathname.endsWith("/active"))
      return Response.json({ visitors: 31 });
    const value = (n) => (legacy ? { value: n, change: 1 } : n);
    const total = parsed.searchParams.get("startAt") === "0";
    return Response.json({
      visitors: value(total ? 3757 : 2644),
      pageviews: value(total ? 6100 : 3967),
    });
  };
  return { calls, fetcher };
}

test("汇总五个数字，按 UTC+8 计算今日，不向调用方暴露分享凭据", async () => {
  const fake = upstream();
  const now = () => Date.parse("2026-10-13T02:00:00Z");
  const load = createTrafficService({ fetcher: fake.fetcher, now });
  const stats = await load(shareURL);
  assert.deepEqual(stats, {
    today: { visitors: 2644, pageviews: 3967 },
    total: { visitors: 3757, pageviews: 6100 },
    online: 31,
    updatedAt: "2026-10-13T02:00:00.000Z",
  });
  const today = fake.calls.find(
    ({ url }) =>
      url.searchParams.get("startAt") !== "0" &&
      url.pathname.endsWith("/stats"),
  );
  assert.equal(
    today.url.searchParams.get("startAt"),
    String(Date.parse("2026-10-12T16:00:00Z")),
  );
  assert.equal(today.url.searchParams.get("timezone"), "Asia/Shanghai");
  assert.equal(JSON.stringify(stats).includes("private-token"), false);
});

test("合并并发请求，30 秒内复用缓存，跨天立即更新", async () => {
  const fake = upstream({ legacy: true });
  let clock = Date.parse("2026-10-13T15:59:50Z");
  const load = createTrafficService({
    fetcher: fake.fetcher,
    now: () => clock,
  });
  await Promise.all([load(shareURL), load(shareURL), load(shareURL)]);
  assert.equal(fake.calls.length, 4);
  clock += 5000;
  await load(shareURL);
  assert.equal(fake.calls.length, 4);
  clock += 5000;
  await load(shareURL);
  assert.equal(fake.calls.length, 8);
  clock += 31000;
  await load(shareURL);
  assert.equal(fake.calls.length, 12);
});

test("拒绝非法站点信息、不安全地址和无效分享配置", async () => {
  const fake = upstream({ wrongSite: true });
  const load = createTrafficService({ fetcher: fake.fetcher });
  for (const value of [
    undefined,
    "https://umami.amoe.cc/not-a-share/test",
    "http://umami.amoe.cc/share/test",
    "https://user:secret@umami.amoe.cc/share/test",
  ]) {
    await assert.rejects(() => load(value));
  }
  assert.equal(fake.calls.length, 0);
  await assert.rejects(() => load(shareURL));
  assert.equal(fake.calls.length, 1);
});

test("使用分享链接的 Umami 域名及网站 ID，切换实例不复用缓存", async () => {
  const siteId = "11111111-2222-3333-4444-555555555555";
  const fake = upstream({ siteId });
  const load = createTrafficService({ fetcher: fake.fetcher });
  await load("https://analytics.example/share/test-share");
  assert.equal(fake.calls.length, 4);
  assert.ok(
    fake.calls.every(({ url }) => url.origin === "https://analytics.example"),
  );
  assert.ok(
    fake.calls.slice(1).every(({ url }) => url.pathname.includes(siteId)),
  );
  await load("https://analytics-two.example/share/test-share");
  assert.equal(fake.calls.length, 8);
  assert.ok(
    fake.calls
      .slice(4)
      .every(({ url }) => url.origin === "https://analytics-two.example"),
  );
});

test("跨零点时不复用尚未完成的昨日请求", async () => {
  const fake = upstream();
  let clock = Date.parse("2026-10-13T15:59:59.500Z");
  let release;
  let first = true;
  const fetcher = (url, options) => {
    if (first) {
      first = false;
      return new Promise((resolve) => {
        release = () => resolve(fake.fetcher(url, options));
      });
    }
    return fake.fetcher(url, options);
  };
  const load = createTrafficService({ fetcher, now: () => clock });
  const yesterday = load(shareURL);
  clock += 1000;
  const today = load(shareURL);
  release();
  const results = await Promise.all([yesterday, today]);
  assert.equal(results[1].updatedAt, "2026-10-13T16:00:00.500Z");
  assert.equal(fake.calls.length, 8);
});

test("上游失败时拒绝返回统计，拒绝负数、缺项和不安全的计数", async () => {
  const fake = upstream({ fail: true });
  const load = createTrafficService({ fetcher: fake.fetcher });
  await assert.rejects(() => load(shareURL));
  for (const visitors of [-1, null, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = upstream();
    const fetcher = async (url, options) =>
      String(url).includes("/active")
        ? Response.json({ visitors })
        : invalid.fetcher(url, options);
    await assert.rejects(() => createTrafficService({ fetcher })(shareURL));
  }
});

test("上游失败退避 5 秒后可重新查询", async () => {
  const fake = upstream();
  let clock = Date.parse("2026-10-13T02:00:00Z");
  let broken = true;
  let failures = 0;
  const fetcher = (...args) => {
    if (!broken) return fake.fetcher(...args);
    failures++;
    return Promise.resolve(
      new Response("private upstream failure", { status: 500 }),
    );
  };
  const load = createTrafficService({ fetcher, now: () => clock });
  await assert.rejects(() => load(shareURL));
  await assert.rejects(() => load(shareURL));
  assert.equal(failures, 1);
  broken = false;
  clock += 5001;
  assert.equal((await load(shareURL)).online, 31);
});

test("使用 Workers 支持的手动重定向模式，并拒绝上游跳转", async () => {
  const fake = upstream();
  const fetcher = (url, options) => {
    assert.equal(options.redirect, "manual");
    return fake.fetcher(url, options);
  };
  assert.equal((await createTrafficService({ fetcher })(shareURL)).online, 31);
  let calls = 0;
  const redirect = async (_url, options) => {
    calls++;
    assert.equal(options.redirect, "manual");
    return new Response(null, {
      status: 302,
      headers: { Location: "https://other.example/" },
    });
  };
  await assert.rejects(() =>
    createTrafficService({ fetcher: redirect })(shareURL),
  );
  assert.equal(calls, 1);
});
