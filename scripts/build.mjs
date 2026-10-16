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
const commit = (
  process.env.WORKERS_CI_COMMIT_SHA ||
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fileURLToPath(root),
    encoding: "utf8",
  })
).trim();

if (!/^[0-9a-f]{40}$/i.test(commit)) {
  throw new Error("Expected a full Git commit SHA for the footer version.");
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
