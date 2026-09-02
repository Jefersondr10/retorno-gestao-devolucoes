export type BoundedJsonResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string; status: 400 | 413 };

export async function readBoundedJsonObject(request: Request, maximumBytes: number): Promise<BoundedJsonResult> {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    return { ok: false, error: 'A solicitação ficou grande demais.', status: 413 };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: true, value: {} };
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel('PAYLOAD_TOO_LARGE').catch(() => undefined);
        return { ok: false, error: 'A solicitação ficou grande demais.', status: 413 };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    const parsed = JSON.parse(text || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ok: true, value: parsed as Record<string, unknown> }
      : { ok: false, error: 'A solicitação não contém dados válidos.', status: 400 };
  } catch {
    return { ok: false, error: 'A solicitação não contém dados válidos.', status: 400 };
  }
}
