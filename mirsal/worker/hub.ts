import { DurableObject } from 'cloudflare:workers';
import { authenticateToken } from './auth';
import { getMemberIds, mapDevice, mapUser } from './db';
import type { Env, HubEvent } from './types';
import { nowIso } from './util';

interface SocketMeta {
  userId?: string;
  deviceId?: string;
}

const MEMBER_CACHE_MS = 60_000;
const CALL_EVENTS = new Set(['call:offer', 'call:answer', 'call:ice', 'call:reject', 'call:end']);

/**
 * One global Durable Object that owns every live WebSocket.
 * It uses the Hibernation API, so idle connections cost nothing while they sit open.
 * D1 stays the source of truth; this object only routes events and tracks who is online.
 */
export class Hub extends DurableObject<Env> {
  private memberCache = new Map<string, { ids: string[]; exp: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeat answered by the runtime without waking this object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({} satisfies SocketMeta);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/online' && request.method === 'GET') {
      return Response.json({ userIds: Array.from(this.onlineUserIds()) });
    }

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const body = (await request.json()) as { events: HubEvent[]; invalidateConversations?: string[] };
      for (const id of body.invalidateConversations ?? []) this.memberCache.delete(id);
      for (const ev of body.events) this.sendToUsers(ev.userIds, ev.payload);
      return Response.json({ ok: true });
    }

    if (url.pathname === '/revoke' && request.method === 'POST') {
      const { userId, deviceId } = (await request.json()) as { userId: string; deviceId: string };
      for (const ws of this.ctx.getWebSockets()) {
        if (this.meta(ws).deviceId === deviceId) {
          this.safeSend(ws, { type: 'device:revoked', deviceId });
          try {
            ws.close(4001, 'revoked');
          } catch {
            /* already closed */
          }
        }
      }
      await this.pushDevices(userId);
      await this.pushPresence();
      return Response.json({ ok: true });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const type = String(data.type || '');
    const meta = this.meta(ws);

    if (type === 'auth:hello') {
      const auth = await authenticateToken(this.env, String(data.token || ''));
      if (!auth) {
        this.safeSend(ws, { type: 'auth:error' });
        ws.close(4001, 'unauthorized');
        return;
      }
      ws.serializeAttachment({ userId: auth.userId, deviceId: auth.deviceId } satisfies SocketMeta);
      const now = nowIso();
      await this.env.DB.batch([
        this.env.DB.prepare('UPDATE devices SET last_active = ? WHERE id = ?').bind(now, auth.deviceId),
        this.env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, auth.userId),
      ]);
      this.safeSend(ws, { type: 'auth:ok', userId: auth.userId, deviceId: auth.deviceId });
      await this.pushPresence();
      await this.pushDevices(auth.userId);
      return;
    }

    if (!meta.userId) {
      ws.close(4001, 'unauthorized');
      return;
    }

    if (type === 'typing:start' || type === 'typing:stop') {
      const conversationId = String(data.conversationId || '');
      const members = await this.members(conversationId);
      if (!members.includes(meta.userId)) return;
      const payload = { type, conversationId, userId: meta.userId };
      for (const sock of this.ctx.getWebSockets()) {
        const m = this.meta(sock);
        if (sock !== ws && m.userId && members.includes(m.userId)) this.safeSend(sock, payload);
      }
      return;
    }

    if (CALL_EVENTS.has(type)) {
      await this.routeCallEvent(ws, meta.userId, type, data);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const { userId } = this.meta(ws);
    if (userId) {
      await this.env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(nowIso(), userId).run();
    }
    await this.pushPresence(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.pushPresence(ws);
  }

  /* ---------------------------- internals ---------------------------- */

  private async routeCallEvent(ws: WebSocket, fromUserId: string, type: string, data: Record<string, unknown>) {
    const toUserId = String(data.toUserId || '');
    const callId = String(data.callId || '');
    if (!toUserId || !callId || toUserId === fromUserId) return;

    if (type === 'call:offer') {
      const conversationId = String(data.conversationId || '');
      const members = await this.members(conversationId);
      if (members.length !== 2 || !members.includes(fromUserId) || !members.includes(toUserId)) return;
      if (!this.isOnline(toUserId)) {
        this.safeSend(ws, { type: 'call:unavailable', callId });
        return;
      }
      const caller = await this.env.DB.prepare('SELECT * FROM users WHERE id = ?')
        .bind(fromUserId)
        .first<Record<string, unknown>>();
      if (!caller) return;
      const user = mapUser(caller, new Set());
      this.sendToUsers([toUserId], {
        type,
        callId,
        conversationId,
        kind: data.kind === 'video' ? 'video' : 'audio',
        offer: data.offer,
        fromUserId,
        fromName: user.displayName,
        fromAvatar: user.avatar,
      });
      return;
    }

    const payload: Record<string, unknown> = { type, callId, fromUserId };
    if (type === 'call:answer') payload.answer = data.answer;
    if (type === 'call:ice') payload.candidate = data.candidate;
    this.sendToUsers([toUserId], payload);

    // When one device answers or declines, stop the other devices of the same account from ringing.
    if (type === 'call:answer' || type === 'call:reject') {
      for (const sock of this.ctx.getWebSockets()) {
        if (sock !== ws && this.meta(sock).userId === fromUserId) this.safeSend(sock, { type: 'call:handled', callId });
      }
    }
  }

  private meta(ws: WebSocket): SocketMeta {
    return (ws.deserializeAttachment() as SocketMeta | null) ?? {};
  }

  private onlineUserIds(exclude?: WebSocket): Set<string> {
    const set = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      const { userId } = this.meta(ws);
      if (userId) set.add(userId);
    }
    return set;
  }

  private isOnline(userId: string): boolean {
    return this.onlineUserIds().has(userId);
  }

  private async members(conversationId: string): Promise<string[]> {
    if (!conversationId) return [];
    const hit = this.memberCache.get(conversationId);
    if (hit && hit.exp > Date.now()) return hit.ids;
    const ids = await getMemberIds(this.env.DB, conversationId);
    this.memberCache.set(conversationId, { ids, exp: Date.now() + MEMBER_CACHE_MS });
    return ids;
  }

  private safeSend(ws: WebSocket, payload: unknown): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* socket already gone */
    }
  }

  private sendToUsers(userIds: string[] | null, payload: unknown): void {
    const target = userIds ? new Set(userIds) : null;
    const text = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      const { userId } = this.meta(ws);
      if (!userId) continue;
      if (target && !target.has(userId)) continue;
      try {
        ws.send(text);
      } catch {
        /* socket already gone */
      }
    }
  }

  private async pushPresence(exclude?: WebSocket): Promise<void> {
    this.sendToUsers(null, { type: 'presence:update', onlineUserIds: Array.from(this.onlineUserIds(exclude)) });
  }

  private async pushDevices(userId: string): Promise<void> {
    const { results } = await this.env.DB.prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY last_active DESC')
      .bind(userId)
      .all<Record<string, unknown>>();
    this.sendToUsers([userId], { type: 'devices:updated', devices: results.map(mapDevice) });
  }
}
