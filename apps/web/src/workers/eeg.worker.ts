import { validateEeg } from '@evertrace/shared';
self.onmessage = async (event: MessageEvent<{ bytes: Uint8Array; name: string }>) => {
  const result = await validateEeg(event.data.bytes, event.data.name);
  self.postMessage(result);
};
