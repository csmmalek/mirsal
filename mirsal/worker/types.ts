export interface Env {
  DB: D1Database;
  HUB: DurableObjectNamespace;
  ASSETS: Fetcher;
  /** Optional: Cloudflare Calls TURN credentials so voice/video work on mobile networks. */
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

export interface AuthCtx {
  userId: string;
  deviceId: string;
}

export interface HubEvent {
  /** null = every connected socket */
  userIds: string[] | null;
  payload: unknown;
}
