const maxBytes = 5 * 1024 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function imageFormat(data) {
  if (
    data.length >= 45 &&
    data.subarray(0, 8).equals(pngSignature) &&
    data.toString("ascii", 12, 16) === "IHDR" &&
    data.readUInt32BE(16) > 0 &&
    data.readUInt32BE(20) > 0 &&
    data.toString("hex", data.length - 12) === "0000000049454e44ae426082"
  )
    return "png";
  if (data.length >= 22 && data.readUInt32LE(0) === 0x00010000) {
    const count = data.readUInt16LE(4);
    const directoryEnd = 6 + count * 16;
    if (!count || directoryEnd > data.length) return;
    for (let offset = 6; offset < directoryEnd; offset += 16) {
      const size = data.readUInt32LE(offset + 8);
      const start = data.readUInt32LE(offset + 12);
      if (!size || start < directoryEnd || start + size > data.length) return;
    }
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
