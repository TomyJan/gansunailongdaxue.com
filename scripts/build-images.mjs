import { inflateSync } from "node:zlib";
import { PNG } from "pngjs";
import decodeICO from "decode-ico";

const maxBytes = 5 * 1024 * 1024;
const maxPixels = 4 * 1024 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pngBitDepths = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

function pngDimensions(data) {
  if (
    data.length < 33 ||
    !data.subarray(0, 8).equals(pngSignature) ||
    data.readUInt32BE(8) !== 13 ||
    data.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error("invalid PNG header");
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (!width || !height || width * height > maxPixels)
    throw new Error("image exceeds 4 megapixels or has invalid dimensions");
  if (
    !pngBitDepths[data[25]]?.includes(data[24]) ||
    data[26] !== 0 || data[27] !== 0 || ![0, 1].includes(data[28])
  ) throw new Error("invalid PNG IHDR fields");
  return { width, height };
}

function validatePNG(data) {
  const { width, height } = pngDimensions(data);
  const compressed = [];
  let paletteEntries = 0;
  let seenIDAT = false;
  let endedIDAT = false;
  let seenIEND = false;
  // pngjs 对重复 IHDR/PLTE 较宽松；先固定唯一尺寸和调色板上限，
  // 仅做关键块结构预检，像素与 CRC 仍由成熟解码器验证。
  for (let offset = 8; offset < data.length;) {
    if (offset + 12 > data.length) throw new Error("truncated PNG chunk");
    const length = data.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > data.length) throw new Error("truncated PNG chunk");
    const type = data.toString("latin1", offset + 4, offset + 8);
    if (seenIDAT && type !== "IDAT") endedIDAT = true;
    if (type === "IHDR") {
      if (offset !== 8) throw new Error("duplicate PNG IHDR");
    } else if (type === "PLTE") {
      if (
        paletteEntries || seenIDAT || [0, 4].includes(data[25]) ||
        !length || length % 3 || length > 768 ||
        (data[25] === 3 && length / 3 > 2 ** data[24])
      ) throw new Error("invalid PNG PLTE");
      paletteEntries = length / 3;
    } else if (type === "IDAT") {
      if (endedIDAT || (data[25] === 3 && !paletteEntries))
        throw new Error("invalid PNG IDAT order or missing palette");
      seenIDAT = true;
      compressed.push(data.subarray(offset + 8, end - 4));
    } else if (type === "IEND") {
      if (length || !seenIDAT || end !== data.length)
        throw new Error("invalid PNG IEND");
      seenIEND = true;
    } else if (!/^[a-zA-Z]{4}$/.test(type) || !(data[offset + 4] & 0x20)) {
      throw new Error("invalid or unsupported PNG chunk");
    }
    offset = end;
  }
  if (!seenIEND) throw new Error("missing PNG IEND");
  // pngjs 的交错路径没有解压上限。先约束完整 zlib 输出，再交由它
  // 校验 CRC、滤波、调色板及像素；每像素最多 8 字节，另含 Adam7 行开销。
  inflateSync(Buffer.concat(compressed), {
    maxOutputLength: width * height * 8 + height * 2 + 7,
  });
  const decoded = PNG.sync.read(data);
  if (
    decoded.width !== width || decoded.height !== height ||
    decoded.data.length !== width * height * 4
  ) throw new Error("decoded PNG dimensions do not match IHDR");
}

function imageFormat(data) {
  if (
    data.length >= 45 &&
    data.subarray(0, 8).equals(pngSignature) &&
    data.toString("ascii", 12, 16) === "IHDR" &&
    data.readUInt32BE(16) > 0 &&
    data.readUInt32BE(20) > 0 &&
    data.toString("hex", data.length - 12) === "0000000049454e44ae426082"
  ) {
    validatePNG(data);
    return "png";
  }
  if (data.length >= 22 && data.readUInt32LE(0) === 0x00010000) {
    const count = data.readUInt16LE(4);
    const directoryEnd = 6 + count * 16;
    if (!count || directoryEnd > data.length) return;
    let pixels = 0;
    for (let offset = 6; offset < directoryEnd; offset += 16) {
      const size = data.readUInt32LE(offset + 8);
      const start = data.readUInt32LE(offset + 12);
      if (!size || start < directoryEnd || start + size > data.length) return;
      const image = data.subarray(start, start + size);
      const width = data[offset] || 256;
      const height = data[offset + 1] || 256;
      pixels += width * height;
      if (pixels > maxPixels) throw new Error("ICO exceeds 4 megapixels in total");
      if (image.subarray(0, 8).equals(pngSignature)) {
        const dimensions = pngDimensions(image);
        if (dimensions.width !== width || dimensions.height !== height)
          throw new Error("ICO dimensions do not match its PNG image");
        validatePNG(image);
      } else {
        // 限定解码器支持的未压缩 DIB，尺寸检查必须先于像素分配。
        if (
          image.length < 40 ||
          image.readUInt32LE(0) < 40 ||
          image.readUInt32LE(0) > image.length ||
          image.readInt32LE(4) !== width ||
          image.readInt32LE(8) !== height * 2 ||
          image.readUInt16LE(12) !== 1 ||
          ![1, 4, 8, 24, 32].includes(image.readUInt16LE(14)) ||
          image.readUInt32LE(16) !== 0
        ) {
          throw new Error("invalid or unsupported ICO DIB image");
        }
      }
    }
    decodeICO(data);
    return "ico";
  }
}

export async function loadBuildImages(env) {
  const files = [];
  let faviconPath = "/favicon.ico";
  for (const name of ["LOGO_URL", "FAVICON_URL"]) {
    const source = env[name]?.trim();
    if (!source) continue;
    try {
      const url = new URL(source);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      ) {
        throw new Error("expected an absolute HTTP(S) URL without credentials");
      }
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`download failed (HTTP ${response.status})`);
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes) throw new Error("image exceeds 5 MiB");
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      const format = imageFormat(data);
      if (!format || (name === "LOGO_URL" && format !== "png")) {
        throw new Error(
          name === "LOGO_URL"
            ? "expected a PNG image"
            : "expected a PNG or ICO image",
        );
      }
      const path = name === "LOGO_URL" ? "logo.png" : `favicon.${format}`;
      files.push([path, data]);
      if (name === "FAVICON_URL") faviconPath = `/${path}`;
    } catch (error) {
      throw new Error(`${name}: ${error.message}`);
    }
  }
  return { files, faviconPath };
}
