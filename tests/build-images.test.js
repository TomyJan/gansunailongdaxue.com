import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { PNG } from "pngjs";
import { loadBuildImages } from "../scripts/build-images.mjs";
import { defaults } from "../scripts/site-config.mjs";

const exec = promisify(execFile);
const root = new URL("../", import.meta.url);
const logo = await readFile(new URL("public/logo.png", root));
const favicon = await readFile(new URL("public/favicon.ico", root));

function withoutIDAT(png) {
  const chunks = [png.subarray(0, 8)];
  for (let offset = 8; offset < png.length;) {
    const end = offset + 12 + png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) !== "IDAT")
      chunks.push(png.subarray(offset, end));
    offset = end;
  }
  return Buffer.concat(chunks);
}

function wrapICO(image, width = 1, height = 1) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = width;
  header[7] = height;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(image.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, image]);
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function pngImage({ depth = 8, color = 6, compression = 0, filter = 0, interlace = 0, before = [], between = [], raw = Buffer.alloc(9) } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([depth, color, compression, filter, interlace], 8);
  return Buffer.concat([
    logo.subarray(0, 8), pngChunk("IHDR", header), ...before,
    pngChunk("IDAT", deflateSync(raw)), ...between,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const invalidPNGStructure = [
  ["重复 IHDR", await readFile(new URL("fixtures/duplicate-header-small.png", import.meta.url))],
  ["重复 IHDR 绕过像素上限", await readFile(new URL("fixtures/duplicate-header-limit.png", import.meta.url))],
  ["RGBA1 非法组合", await readFile(new URL("fixtures/illegal-rgba1.png", import.meta.url))],
  ["RGB4 非法组合", pngImage({ depth: 4, color: 2 })],
  ["灰度透明2 非法组合", pngImage({ depth: 2, color: 4 })],
  ["索引16 非法组合", pngImage({ depth: 16, color: 3, before: [pngChunk("PLTE", Buffer.alloc(3))] })],
  ["非法压缩方法", pngImage({ compression: 1 })],
  ["非法滤波方法", pngImage({ filter: 1 })],
  ["非法交错方法", pngImage({ interlace: 2 })],
  ["超大 PLTE", pngImage({ before: [pngChunk("PLTE", Buffer.alloc(771))] })],
  ["不完整 PLTE 颜色项", pngImage({ before: [pngChunk("PLTE", Buffer.alloc(4))] })],
  ["重复 PLTE", pngImage({ before: [pngChunk("PLTE", Buffer.alloc(3)), pngChunk("PLTE", Buffer.alloc(3))] })],
  ["PLTE 晚于 IDAT", pngImage({ between: [pngChunk("PLTE", Buffer.alloc(3))] })],
  ["索引调色板超出位深", pngImage({ depth: 1, color: 3, before: [pngChunk("PLTE", Buffer.alloc(9))] })],
  ["灰度包含 PLTE", pngImage({ color: 0, before: [pngChunk("PLTE", Buffer.alloc(3))] })],
  ["空 PLTE", pngImage({ before: [pngChunk("PLTE", Buffer.alloc(0))] })],
  ["非连续 IDAT", pngImage({ between: [pngChunk("tEXt", Buffer.from("key\0value")), pngChunk("IDAT", Buffer.alloc(0))] })],
  ["重复 IEND", Buffer.concat([pngImage(), pngChunk("IEND", Buffer.alloc(0))])],
];

for (const [label, data] of invalidPNGStructure) {
  for (const embedded of [false, true]) {
    // 大尺寸绕过样本不适合合法 ICO 目录，独立 PNG 仍覆盖其资源上限。
    if (embedded && label === "重复 IHDR 绕过像素上限") continue;
    test(`结构校验拒绝${label}${embedded ? "（ICO 内 PNG）" : "（独立 PNG）"}`, async (t) => {
      t.mock.method(globalThis, "fetch", async () => new Response(embedded ? wrapICO(data) : data));
      await assert.rejects(loadBuildImages({ FAVICON_URL: "https://images.test/icon" }));
    });
  }
}

test("PNG 结构和头字段在调用像素解码器前拒绝", async (t) => {
  t.mock.method(PNG.sync, "read", () => {
    throw new Error("pixel decoder must not be reached");
  });
  for (const [, data] of invalidPNGStructure) {
    for (const image of [data, wrapICO(data)]) {
      const mocked = t.mock.method(globalThis, "fetch", async () => new Response(image));
      await assert.rejects(
        loadBuildImages({ FAVICON_URL: "https://images.test/icon" }),
        (error) => !error.message.includes("pixel decoder must not be reached"),
      );
      mocked.mock.restore();
    }
  }
});

test("保留所有合法 PNG 位深颜色组合、连续 IDAT 及建议调色板", async (t) => {
  for (const [depth, color, rowBytes] of [
    [1, 0, 2], [2, 0, 2], [4, 0, 2], [8, 0, 2], [16, 0, 3],
    [8, 2, 4], [16, 2, 7],
    [1, 3, 2], [2, 3, 2], [4, 3, 2], [8, 3, 2],
    [8, 4, 3], [16, 4, 5], [8, 6, 5], [16, 6, 9],
  ]) {
    const palette = [2, 3, 6].includes(color) ? [pngChunk("PLTE", Buffer.alloc(3))] : [];
    const data = pngImage({ depth, color, before: palette, raw: Buffer.alloc(rowBytes), between: [pngChunk("IDAT", Buffer.alloc(0))] });
    for (const image of [data, wrapICO(data)]) {
      const mocked = t.mock.method(globalThis, "fetch", async () => new Response(image));
      const result = await loadBuildImages({ FAVICON_URL: "https://images.test/icon" });
      assert.ok(result.files[0][1].equals(image), `depth=${depth}, color=${color}`);
      mocked.mock.restore();
    }
  }
});

const tinyPNG = PNG.sync.write({ width: 1, height: 1, data: Buffer.from([255, 0, 0, 255]) });
const dib = Buffer.alloc(48);
dib.writeUInt32LE(40);
dib.writeInt32LE(1, 4);
dib.writeInt32LE(2, 8);
dib.writeUInt16LE(1, 12);
dib.writeUInt16LE(32, 14);
dib.set([0, 0, 255, 255], 40);
const hugeHeader = Buffer.from(tinyPNG.subarray(16, 29));
hugeHeader.writeUInt32BE(100000, 0);
hugeHeader.writeUInt32BE(100000, 4);
const excessivePNG = Buffer.concat([
  tinyPNG.subarray(0, 33),
  pngChunk("IDAT", deflateSync(Buffer.alloc(1024 * 1024))),
  pngChunk("IEND", Buffer.alloc(0)),
]);
const oversizedPNG = Buffer.concat([
  tinyPNG.subarray(0, 8), pngChunk("IHDR", hugeHeader), tinyPNG.subarray(33),
]);
// 两个目录项：有效帧之后的损坏帧也必须检查。
const mixedICO = Buffer.concat([wrapICO(dib).subarray(0, 22), wrapICO(Buffer.from([0])).subarray(6)]);
mixedICO.writeUInt16LE(2, 4);
mixedICO.writeUInt32LE(38, 18);
mixedICO.writeUInt32LE(38 + dib.length, 34);
const mixedFrames = Buffer.concat([mixedICO.subarray(0, 38), dib, Buffer.from([0])]);

for (const [label, data] of [
  ["无 IDAT 的 PNG", withoutIDAT(logo)],
  ["一字节垃圾 ICO", wrapICO(Buffer.from([0]))],
  ["包含损坏 PNG 的 ICO", wrapICO(withoutIDAT(tinyPNG))],
  ["第二帧损坏的 ICO", mixedFrames],
  ["超大像素尺寸 PNG", oversizedPNG],
  ["超量解压数据 PNG", excessivePNG],
]) {
  test(`拒绝${label}`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response(data));
    await assert.rejects(loadBuildImages({ FAVICON_URL: "https://images.test/icon" }));
  });
}

test("保留合法 PNG、PNG ICO、带 AND 掩码的 DIB ICO 与 Adam7 交错 PNG", async (t) => {
  // Adam7 样本由独立的 Pillow 解码验证，11×9 RGBA8。
  const adam7 = await readFile(new URL("fixtures/adam7.png", import.meta.url));
  for (const data of [tinyPNG, wrapICO(tinyPNG), wrapICO(dib), adam7]) {
    const mocked = t.mock.method(globalThis, "fetch", async () => new Response(data));
    const images = await loadBuildImages({ FAVICON_URL: "https://images.test/icon" });
    assert.ok(images.files[0][1].equals(data));
    mocked.mock.restore();
  }
});

test("构建时下载图片并替换本站资源，未配置的图片独立回退", async (t) => {
  const server = createServer((request, response) => {
    if (request.url === "/logo") response.end(logo);
    else if (request.url === "/icon") response.end(favicon);
    else if (request.url === "/bad") response.end("<html>not an image</html>");
    else if (request.url === "/truncated") response.end(logo.subarray(0, 32));
    else if (request.url === "/no-idat") response.end(withoutIDAT(logo));
    else if (request.url === "/garbage-ico") response.end(wrapICO(Buffer.from([0])));
    else if (request.url === "/broken-png-ico") response.end(wrapICO(withoutIDAT(logo)));
    else if (request.url === "/large")
      response.end(Buffer.alloc(5 * 1024 * 1024 + 1));
    else response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const sandbox = await mkdtemp(join(tmpdir(), "nailong-images-"));
  try {
    await symlink(await realpath(new URL("node_modules", root)), join(sandbox, "node_modules"), "junction");
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
      "拒绝外壳完整但无法解码的 PNG/ICO，失败保留全部已有构建产物",
      async () => {
        for (const [name, path] of [
          ["LOGO_URL", "/no-idat"],
          ["FAVICON_URL", "/no-idat"],
          ["FAVICON_URL", "/garbage-ico"],
          ["FAVICON_URL", "/broken-png-ico"],
        ]) {
          await writeFile(join(sandbox, "dist/index.html"), "previous-page");
          await writeFile(join(sandbox, "dist/logo.png"), "previous-logo");
          await assert.rejects(build({ [name]: `${origin}${path}` }), (error) => {
            assert.ok(error.stderr.includes(name));
            return true;
          });
          assert.equal(await readFile(join(sandbox, "dist/index.html"), "utf8"), "previous-page");
          assert.equal(await readFile(join(sandbox, "dist/logo.png"), "utf8"), "previous-logo");
        }
      },
    );
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
