import { createTrafficService, todayStart } from "./traffic.js";

const traffic = createTrafficService();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/traffic") {
      const headers = { "Cache-Control": "no-store" };
      if (request.method !== "GET") {
        return Response.json(
          { error: "Method not allowed" },
          { status: 405, headers: { ...headers, Allow: "GET" } },
        );
      }
      if (!env.UMAMI_SHARE_URL) {
        return Response.json(
          { error: "访问统计暂不可用" },
          { status: 503, headers },
        );
      }
      const cache = globalThis.caches?.default;
      try {
        // 分享配置仅以摘要区分缓存，避免将 Secret 写入缓存 URL。
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(env.UMAMI_SHARE_URL),
        );
        const shareKey = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        const key = new Request(
          new URL(`/api/traffic?day=${todayStart()}&share=${shareKey}`, url),
        );
        const cached = await cache?.match(key).catch(() => undefined);
        if (cached)
          return new Response(cached.body, {
            headers: {
              ...headers,
              "Content-Type": "application/json; charset=utf-8",
            },
          });
        const stats = await traffic(env.UMAMI_SHARE_URL);
        const response = Response.json(stats, { headers });
        if (
          cache &&
          ctx &&
          todayStart(Date.parse(stats.updatedAt)) === todayStart()
        ) {
          const ttl = Math.floor(
            (Math.min(
              Date.parse(stats.updatedAt) + 30000,
              todayStart() + 86400000,
            ) -
              Date.now()) /
              1000,
          );
          if (ttl > 0) {
            const stored = Response.json(stats, {
              headers: { "Cache-Control": `public, max-age=${ttl}` },
            });
            ctx.waitUntil(cache.put(key, stored).catch(() => {}));
          }
        }
        return response;
      } catch {
        return Response.json(
          { error: "访问统计暂不可用，请稍后刷新" },
          { status: 503, headers: { ...headers, "Retry-After": "5" } },
        );
      }
    }
    return env.ASSETS.fetch(request);
  },
};
