export const defaults = {
  SITE_NAME: "甘肃奶龙大学",
  STICKER_TXT: "奶龙出没",
  GO_BTN_TXT: "GO",
  GO_BTN_TGT: "https://www.lut.edu.cn/",
  UMAMI_SCRIPT_URL: "https://umami.amoe.cc/script.js",
  UMAMI_SITE_ID: "ee3cbb93-6ca4-4164-8a6c-4bb22b80675d",
  GROUP_NAME: "兰理",
  GROUP_LINK: "https://qm.qq.com/q/AjLVv044nu",
};

function escapeHTML(value) {
  const entities = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

export function renderPage(template, env, commit, images = {}) {
  const config = Object.fromEntries(
    Object.entries(defaults).map(([name, fallback]) => [
      name,
      env[name]?.trim() || fallback,
    ]),
  );
  const showGroup = config.GROUP_NAME !== "-" && config.GROUP_LINK !== "-";
  for (const name of [
    "GO_BTN_TGT",
    "UMAMI_SCRIPT_URL",
    ...(showGroup ? ["GROUP_LINK"] : []),
  ]) {
    let url;
    try {
      url = new URL(config[name]);
    } catch {
      throw new Error(`${name} must be an absolute HTTP(S) URL`);
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error(`${name} must be an HTTP(S) URL without credentials`);
  }
  config.COMMIT_SHORT = commit.slice(0, 7);
  config.FAVICON_PATH = images.faviconPath || "/favicon.ico";
  config.GO_BTN_CLASS =
    Array.from(config.GO_BTN_TXT).length > 2 ? " go--label" : "";
  // 先处理模板区块，再转义替换，避免把用户文案解释成模板指令。
  return template
    .replace(
      /<!-- GROUP_START -->([\s\S]*?)<!-- GROUP_END -->/g,
      (_, content) => (showGroup ? content : ""),
    )
    .replace(/__([A-Z_]+)__/g, (token, name) =>
      Object.hasOwn(config, name) ? escapeHTML(config[name]) : token,
    );
}
