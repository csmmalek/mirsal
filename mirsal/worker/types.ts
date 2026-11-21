export interface Env {
  DB: D1Database;
  /** Email verification via Resend. Secrets: RESEND_API_KEY, MAIL_FROM. EMAIL_VERIFICATION defaults to on; set to 'off' only for local dev. */
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  EMAIL_VERIFICATION?: string;
  /** Google sign-in: the OAuth client id (not secret). */
  GOOGLE_CLIENT_ID?: string;
  HUB: DurableObjectNamespace;
  ASSETS: Fetcher;
  /** Optional: Cloudflare Calls TURN credentials so voice/video work on mobile networks. */
  /** Secret that lets the developer claim the reserved admin email the first time. */
  ADMIN_SETUP_CODE?: string;
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
