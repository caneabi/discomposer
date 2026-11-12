/** Read a body with a hard byte limit, including bodies without Content-Length. */
export async function readBody(message: Request | Response, limit: number): Promise<Uint8Array> {
  const reader = message.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(message.headers.get("content-length")) > limit) {
      throw new RangeError("The response is too large.");
    }
    if (!reader) return new Uint8Array();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new RangeError("The response is too large.");
      chunks.push(value);
    }
  } catch (error) {
    await reader?.cancel().catch(() => {});
    throw error;
  } finally {
    reader?.releaseLock();
  }
  if (chunks.length === 1) return chunks[0];
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
