import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { defaults, renderPage } from "../scripts/site-config.mjs";
import { execFileSync } from "node:child_process";

const template = await readFile(
  new URL("../public/index.html", import.meta.url),
  "utf8",
);
const commit = "1234567890abcdef1234567890abcdef12345678";

test("静态构建同时生成两份政策，沿用站点配置且不输出分享链接", async () => {
  const root = new URL("../", import.meta.url);
  const sandbox = await mkdtemp(join(tmpdir(), "nailong-build-"));
  try {
    for (const directory of ["public", "scripts"]) {
      await cp(new URL(directory, root), join(sandbox, directory), {
        recursive: true,
      });
    }
    execFileSync(process.execPath, ["scripts/build.mjs"], {
      cwd: sandbox,
      env: {
        ...process.env,
        ...defaults,
        LOGO_URL: "",
        FAVICON_URL: "",
        SITE_NAME: "甘肃奶蛙大学",
        WORKERS_CI_COMMIT_SHA: commit,
        UMAMI_SHARE_URL: "private-share-sentinel",
      },
    });
    for (const path of [
      "index.html",
      "terms/index.html",
      "privacy/index.html",
    ]) {
      const html = await readFile(join(sandbox, "dist", path), "utf8");
      assert.ok(html.includes("甘肃奶蛙大学"));
      assert.ok(!html.includes("private-share-sentinel"));
      assert.ok(!/__([A-Z_]+)__/.test(html));
    }
  } finally {
    assert.equal(dirname(sandbox), resolve(tmpdir()));
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("不配置时生成奶龙默认静态页，不输出后端分享链接", () => {
  const html = renderPage(
    template,
    { UMAMI_SHARE_URL: "private-share-sentinel" },
    commit,
  );
  assert.match(html, /<title>甘肃奶龙大学<\/title>/);
  assert.match(html, /href="https:\/\/www\.lut\.edu\.cn\/"/);
  assert.match(html, /<span>GO<\/span>/);
  assert.match(html, /src="https:\/\/umami\.amoe\.cc\/script\.js"/);
  assert.ok(html.includes(defaults.UMAMI_SITE_ID));
  assert.ok(html.includes("加入兰理奶群"));
  assert.ok(html.includes(defaults.GROUP_LINK));
  assert.ok(html.includes("1234567"));
  assert.ok(!html.includes("private-share-sentinel"));
});

test("奶蛙站配置生成对应标题、按钮及链接，其他字段独立回退", () => {
  const html = renderPage(
    template,
    {
      SITE_NAME: "甘肃奶蛙大学",
      GO_BTN_TXT: "前往红柳易办",
      GO_BTN_TGT: "https://home.lut.edu.cn/",
    },
    commit,
  );
  assert.match(html, /<title>甘肃奶蛙大学<\/title>/);
  assert.match(html, /<span>前往红柳易办<\/span>/);
  assert.match(html, /href="https:\/\/home\.lut\.edu\.cn\/"/);
  assert.match(html, /class="go go--label"/);
  assert.ok(html.includes(defaults.UMAMI_SCRIPT_URL));
  assert.ok(html.includes(defaults.GROUP_NAME));
});

test("每个字段均可独立配置，缺失和空白使用各自默认值", () => {
  for (const [name, value] of Object.entries(defaults)) {
    const token = `__${name}__`;
    assert.equal(renderPage(token, {}, commit), value);
    assert.equal(renderPage(token, { [name]: "  " }, commit), value);
    const custom =
      name.endsWith("URL") || name.endsWith("TGT") || name.endsWith("LINK")
        ? "https://custom.example/value"
        : "自定义值";
    assert.equal(renderPage(token, { [name]: custom }, commit), custom);
  }
});

test("首页贴纸文案可独立配置、回退并转义 HTML", () => {
  const html = renderPage(template, { STICKER_TXT: "奶蛙出没" }, commit);
  assert.ok(html.includes("奶蛙出没"));
  assert.ok(!html.includes("奶龙出没"));
  for (const env of [{}, { STICKER_TXT: "  " }]) {
    assert.ok(renderPage(template, env, commit).includes("奶龙出没"));
  }
  assert.ok(
    renderPage(template, { STICKER_TXT: "奶蛙 <>&" }, commit).includes(
      "奶蛙 &lt;&gt;&amp;",
    ),
  );
});

test("配置文本转义 HTML，替换一次，拒绝可执行 URL", () => {
  const text = "奶蛙 <script>\"&' __GROUP_NAME__";
  const html = renderPage(
    "<title>__SITE_NAME__</title>",
    { SITE_NAME: text },
    commit,
  );
  assert.equal(
    html,
    "<title>奶蛙 &lt;script&gt;&quot;&amp;&#39; __GROUP_NAME__</title>",
  );
  for (const name of ["GO_BTN_TGT", "GROUP_LINK", "UMAMI_SCRIPT_URL"]) {
    assert.throws(() =>
      renderPage(template, { [name]: "javascript:alert(1)" }, commit),
    );
    assert.throws(() =>
      renderPage(
        template,
        { [name]: "https://user:pass@example.com/" },
        commit,
      ),
    );
  }
});
