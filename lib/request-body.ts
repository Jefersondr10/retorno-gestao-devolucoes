export type BoundedJsonResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string; status: 400 | 413 };

export type BoundedFormDataResult =
  | { ok: true; value: FormData }
  | { ok: false; error: string; status: 400 | 413 };

export async function readBoundedFormData(request: Request, maximumBytes: number): Promise<BoundedFormDataResult> {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    return { ok: false, error: 'A solicitação ficou grande demais.', status: 413 };
  }

  if (!request.body) return { ok: false, error: 'A solicitação está vazia.', status: 400 };
  let totalBytes = 0;
  let exceededLimit = false;
  const boundedStream = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        totalBytes += chunk.byteLength;
        if (totalBytes > maximumBytes) {
          exceededLimit = true;
          throw new Error('PAYLOAD_TOO_LARGE');
        }
        controller.enqueue(chunk);
      },
    }),
  );

  try {
    const contentType = request.headers.get('content-type') || '';
    const value = await new Response(boundedStream, { headers: { 'Content-Type': contentType } }).formData();
    return { ok: true, value };
  } catch {
    if (exceededLimit) return { ok: false, error: 'A solicitação ficou grande demais.', status: 413 };
    return { ok: false, error: 'O conteúdo enviado não pôde ser lido.', status: 400 };
  }
}

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
