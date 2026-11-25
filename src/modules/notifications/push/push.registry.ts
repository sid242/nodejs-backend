import type { PushChannel, PushProvider } from './push.types';
import { webPushProvider } from './webpush.provider';

const providers = new Map<PushChannel, PushProvider>([['webpush', webPushProvider]]);

export function getPushProvider(channel: PushChannel): PushProvider | undefined {
  return providers.get(channel);
}

export function registerPushProvider(provider: PushProvider): void {
  providers.set(provider.channel, provider);
}
