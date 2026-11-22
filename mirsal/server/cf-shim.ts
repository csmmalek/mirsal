/**
 * بديل لـ 'cloudflare:workers' على Node. يُستخدم فقط عند نسخ worker/ إلى server/worker/ (انظر prepare.mjs).
 */
export class DurableObject<E = unknown> {
  ctx: unknown;
  env: E;
  constructor(ctx: unknown, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WebSocketRequestResponsePair {
  constructor(
    public request: string,
    public response: string,
  ) {}
}
