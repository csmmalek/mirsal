import type { Env, HubEvent } from './types';

function hubStub(env: Env) {
  return env.HUB.get(env.HUB.idFromName('global'));
}

async function post(env: Env, path: string, body: unknown): Promise<void> {
  try {
    await hubStub(env).fetch(`https://hub${path}`, { method: 'POST', body: JSON.stringify(body) });
  } catch (err) {
    // Realtime is best-effort: the write already succeeded in D1 and clients re-sync on reconnect.
    console.error('hub call failed', path, err);
  }
}

export function broadcast(env: Env, events: HubEvent[], invalidateConversations: string[] = []): Promise<void> {
  return post(env, '/broadcast', { events, invalidateConversations });
}

export function revokeDevice(env: Env, userId: string, deviceId: string): Promise<void> {
  return post(env, '/revoke', { userId, deviceId });
}

export async function getOnlineUserIds(env: Env): Promise<Set<string>> {
  try {
    const res = await hubStub(env).fetch('https://hub/online');
    const data = (await res.json()) as { userIds: string[] };
    return new Set(data.userIds);
  } catch (err) {
    console.error('hub online lookup failed', err);
    return new Set();
  }
}
