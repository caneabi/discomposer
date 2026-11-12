export const MAX_IMAGE = 8 * 1024 * 1024;

/** Detects the format from the bytes. Anything else, including SVG, is rejected. */
export function imageExtension(raw: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...raw.subarray(from, to));
  if (raw[0] === 0x89 && ascii(1, 8) === "PNG\r\n\x1a\n") return "png";
  if (raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff) return "jpg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}
