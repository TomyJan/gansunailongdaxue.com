import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { defaults } from "../scripts/site-config.mjs";

const exec = promisify(execFile);
const root = new URL("../", import.meta.url);
const logo = await readFile(new URL("public/logo.png", root));
const favicon = await readFile(new URL("public/favicon.ico", root));

test("构建时下载图片并替换本站资源，未配置的图片独立回退", async (t) => {
  const server = createServer((request, response) => {
    if (request.url === "/logo") response.end(logo);
    else if (request.url === "/icon") response.end(favicon);
    else if (request.url === "/bad") response.end("<html>not an image</html>");
    else if (request.url === "/truncated") response.end(logo.subarray(0, 32));
    else if (request.url === "/large")
      response.end(Buffer.alloc(5 * 1024 * 1024 + 1));
    else response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const sandbox = await mkdtemp(join(tmpdir(), "nailong-images-"));
  try {
    for (const directory of ["public", "scripts"]) {
      await cp(new URL(directory, root), join(sandbox, directory), {
        recursive: true,
      });
    }
    // 使用不同的默认文件，验证下载内容确实覆盖了构建产物。
    await writeFile(join(sandbox, "public/logo.png"), "default-logo");
    await writeFile(join(sandbox, "public/favicon.ico"), "default-icon");
    const build = (env) =>
      exec(process.execPath, ["scripts/build.mjs"], {
        cwd: sandbox,
        env: {
          ...process.env,
          ...defaults,
          WORKERS_CI_COMMIT_SHA: "1234567890abcdef1234567890abcdef12345678",
          LOGO_URL: "",
          FAVICON_URL: "",
          ...env,
        },
      });
    await t.test(
      "PNG 校徽和 ICO 图标下载到本地，页面不包含源地址",
      async () => {
        await build({
          LOGO_URL: `${origin}/logo`,
          FAVICON_URL: `${origin}/icon`,
        });
        assert.ok(
          (await readFile(join(sandbox, "dist/logo.png"))).equals(logo),
        );
        assert.ok(
          (await readFile(join(sandbox, "dist/favicon.ico"))).equals(favicon),
        );
        for (const page of [
          "index.html",
          "terms/index.html",
          "privacy/index.html",
        ]) {
          const html = await readFile(join(sandbox, "dist", page), "utf8");
          assert.ok(!html.includes(origin));
          assert.ok(html.includes('href="/favicon.ico"'));
          assert.ok(html.includes('src="/logo.png"'));
        }
      },
    );
    await t.test(
      "只配置 PNG 图标时校徽保持默认，所有页面使用正确扩展名",
      async () => {
        await build({ FAVICON_URL: `${origin}/logo` });
        assert.equal(
          await readFile(join(sandbox, "dist/logo.png"), "utf8"),
          "default-logo",
        );
        assert.ok(
          (await readFile(join(sandbox, "dist/favicon.png"))).equals(logo),
        );
        for (const page of [
          "index.html",
          "terms/index.html",
          "privacy/index.html",
        ]) {
          const html = await readFile(join(sandbox, "dist", page), "utf8");
          assert.ok(html.includes('href="/favicon.png"'));
          assert.ok(!html.includes('href="/favicon.ico"'));
          assert.ok(
            !html.includes('rel="icon" type="image/png" href="/logo.png"'),
          );
        }
      },
    );
    await t.test("只配置校徽时图标保持默认", async () => {
      await build({ LOGO_URL: `${origin}/logo` });
      assert.ok((await readFile(join(sandbox, "dist/logo.png"))).equals(logo));
      assert.equal(
        await readFile(join(sandbox, "dist/favicon.ico"), "utf8"),
        "default-icon",
      );
    });
    await t.test("空白配置恢复默认文件和图标路径", async () => {
      await build({ LOGO_URL: " ", FAVICON_URL: " " });
      assert.equal(
        await readFile(join(sandbox, "dist/logo.png"), "utf8"),
        "default-logo",
      );
      assert.equal(
        await readFile(join(sandbox, "dist/favicon.ico"), "utf8"),
        "default-icon",
      );
      assert.ok(
        (await readFile(join(sandbox, "dist/index.html"), "utf8")).includes(
          'href="/favicon.ico"',
        ),
      );
    });
    await t.test(
      "下载失败、无效图片和非法地址使构建失败并指出变量",
      async () => {
        for (const [name, url] of [
          ["LOGO_URL", `${origin}/missing`],
          ["LOGO_URL", `${origin}/bad`],
          ["LOGO_URL", `${origin}/icon`],
          ["LOGO_URL", `${origin}/truncated`],
          ["LOGO_URL", `${origin}/large`],
          ["FAVICON_URL", `${origin}/bad`],
          ["FAVICON_URL", "file:///favicon.ico"],
        ]) {
          await assert.rejects(build({ [name]: url }), (error) => {
            assert.ok(error.stderr.includes(name));
            return true;
          });
        }
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    assert.equal(dirname(sandbox), resolve(tmpdir()));
    await rm(sandbox, { recursive: true, force: true });
  }
});
