const DAY = 86_400_000;
const UTC8 = 8 * 60 * 60 * 1000;

export function todayStart(time = Date.now()) {
  return Math.floor((time + UTC8) / DAY) * DAY - UTC8;
}

function shareConfig(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid share configuration");
  }
  const match = url.pathname.match(
    /^\/share\/([a-zA-Z0-9_-]{1,100})(?:\/[^/]+)?\/?$/,
  );
  if (url.protocol !== "https:" || url.username || url.password || !match) {
    throw new Error("Invalid share configuration");
  }
  return { origin: url.origin, slug: match[1] };
}

function count(input) {
  const value =
    typeof input === "object" && input !== null ? input.value : input;
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid count");
  return value;
}

export function createTrafficService({ fetcher = fetch, now = Date.now } = {}) {
  let cached;
  let flight;

  async function load(origin, slug, time) {
    const signal = AbortSignal.timeout(8000);
    async function get(path, token) {
      const headers = { Accept: "application/json" };
      if (token) {
        headers["x-umami-share-token"] = token;
        headers["x-umami-share-context"] = "1";
      }
      const response = await fetcher(`${origin}${path}`, {
        headers,
        signal,
        redirect: "manual",
      });
      if (!response.ok) throw new Error("Umami unavailable");
      const text = await response.text();
      if (text.length > 65536) throw new Error("Invalid response");
      return JSON.parse(text);
    }

    const share = await get(`/api/share/${slug}`);
    if (
      typeof share?.websiteId !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(share.websiteId) ||
      typeof share.token !== "string" ||
      !share.token ||
      share.token.length > 16384 ||
      (share.shareType != null && share.shareType !== 1)
    ) {
      throw new Error("Invalid website share");
    }
    async function counts(start) {
      const query = new URLSearchParams({
        startAt: String(start),
        endAt: String(time),
        timezone: "Asia/Shanghai",
      });
      const data = await get(
        `/api/websites/${share.websiteId}/stats?${query}`,
        share.token,
      );
      return {
        visitors: count(data?.visitors),
        pageviews: count(data?.pageviews),
      };
    }
    const [today, total, active] = await Promise.all([
      counts(todayStart(time)),
      counts(0),
      get(`/api/websites/${share.websiteId}/active`, share.token),
    ]);
    return {
      today,
      total,
      online: count(active?.visitors),
      updatedAt: new Date(time).toISOString(),
    };
  }

  return async function traffic(shareURL) {
    const { origin, slug } = shareConfig(shareURL);
    const time = now();
    const key = `${origin}:${slug}:${todayStart(time)}`;
    if (cached?.key === key && time < cached.until) {
      if (cached.failed) throw new Error("Umami unavailable");
      return cached.value;
    }
    if (flight?.key === key) return flight.promise;
    const current = { key };
    current.promise = load(origin, slug, time)
      .then((value) => {
        // 只有最近启动的请求可以更新缓存；跨日或切换配置后，旧结果仍可
        // 返回给原调用方，但不得覆盖新请求的成功结果或失败退避状态。
        if (flight === current) {
          cached = {
            key,
            value,
            until: Math.min(time + 30000, todayStart(time) + DAY),
          };
        }
        return value;
      })
      .catch(() => {
        if (flight === current) {
          cached = {
            key,
            failed: true,
            until: Math.min(now() + 5000, todayStart(time) + DAY),
          };
        }
        throw new Error("Umami unavailable");
      })
      .finally(() => {
        if (flight === current) flight = undefined;
      });
    flight = current;
    return current.promise;
  };
}
