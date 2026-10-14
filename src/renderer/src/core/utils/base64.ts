/** ArrayBuffer/Uint8Array -> base64 (chunked so large buffers don't blow the stack). */
export function bytesToBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.includes(',') && base64.startsWith('data:') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(await blob.arrayBuffer());
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',', 2);
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bytes = head.includes(';base64') ? base64ToBytes(body) : new TextEncoder().encode(decodeURIComponent(body));
  return new Blob([bytes as BlobPart], { type: mime });
}
