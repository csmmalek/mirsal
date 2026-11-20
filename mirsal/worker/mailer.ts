import type { Env } from './types';
import { HttpError } from './util';

export type MailSender = (to: string, subject: string, text: string) => Promise<void>;

/** Tests only: captures outgoing mail instead of calling Resend. Never set in production. */
let testSender: MailSender | null = null;
export function setMailSenderForTests(fn: MailSender | null): void {
  testSender = fn;
}

/** Sends a plain-text email through Resend. Throws a readable Arabic HttpError on failure. */
export async function sendMail(env: Env, to: string, subject: string, text: string): Promise<void> {
  if (testSender) return testSender(to, subject, text);
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    throw new HttpError(503, 'خدمة إرسال رموز التحقق غير مهيأة بعد، تواصل مع المطور');
  }
  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }),
    });
  } catch {
    throw new HttpError(502, 'تعذر الاتصال بخدمة البريد، حاول بعد قليل');
  }
  if (!res.ok) throw new HttpError(502, 'تعذر إرسال رمز التحقق، حاول بعد قليل');
}
