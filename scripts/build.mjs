import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import { renderPage } from "./site-config.mjs";
import { loadBuildImages } from "./build-images.mjs";

const root = new URL("../", import.meta.url);
try {
  loadEnvFile(fileURLToPath(new URL(".env", root)));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const commitSource = process.env.WORKERS_CI_COMMIT_SHA
  ? "WORKERS_CI_COMMIT_SHA"
  : "git rev-parse HEAD";
let commit;
try {
  commit = (
    process.env.WORKERS_CI_COMMIT_SHA ||
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: fileURLToPath(root),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  ).trim();
} catch {
  throw new Error(
    "无法读取页脚提交版本：未设置 WORKERS_CI_COMMIT_SHA，且 git rev-parse HEAD 执行失败。请确认构建目录是 Git 仓库、Git 可用；无 Git 环境时请提供 40 位十六进制的完整提交 SHA。",
  );
}

if (!/^[0-9a-f]{40}$/i.test(commit)) {
  throw new Error(
    `页脚提交版本无效。来源：${commitSource}；去除首尾空白后的实际长度：${commit.length}。需要 40 位十六进制的完整 Git 提交 SHA，不能使用短 hash、分支名或变量占位文本。` +
      (commitSource === "WORKERS_CI_COMMIT_SHA"
        ? "请检查 Cloudflare Settings → Build → Build variables and secrets、构建命令和 .env 是否覆盖 WORKERS_CI_COMMIT_SHA；删除手动覆盖后重试，或提供正确的完整 SHA。"
        : "请检查仓库 HEAD 及 Git 对象格式，确认 git rev-parse HEAD 返回 40 位完整提交 SHA。"),
  );
}

// 下载并验证成功后才更新产物，避免失败时覆盖已有页面。
const images = await loadBuildImages(process.env);
const pages = await Promise.all(
  ["index.html", "terms/index.html", "privacy/index.html"].map(async (path) => [
    path,
    renderPage(
      await readFile(new URL(`public/${path}`, root), "utf8"),
      process.env,
      commit,
      images,
    ),
  ]),
);

const output = new URL("dist/", root);
await mkdir(output, { recursive: true });
// 保留目录本身，避免 Windows 上与 Wrangler 的目录监听冲突。
for (const entry of await readdir(output)) {
  await rm(join(fileURLToPath(output), entry), {
    recursive: true,
    force: true,
  });
}
await cp(new URL("public/", root), output, { recursive: true });
await Promise.all(
  images.files.map(([path, data]) => writeFile(new URL(path, output), data)),
);
await Promise.all(
  pages.map(([path, html]) => writeFile(new URL(`dist/${path}`, root), html)),
);
console.log(`Built static page for commit ${commit.slice(0, 7)}.`);
