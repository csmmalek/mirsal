import type { Env } from './types';

/** نموذج Gemini المستخدم. إن تغيّرت أسماء النماذج لاحقاً فغيّر هذه القيمة فقط. */
const MODEL = 'gemini-2.5-flash';

const SYSTEM_PROMPT =
  'أنت مساعد مفيد داخل تطبيق مِرسال للمراسلة. أجب بالعربية بإيجاز ووضوح. ' +
  'لا تطلب كلمات مرور أو مفاتيح أو رموزاً من المستخدم. ' +
  'إذا سُئلت عن استعادة كلمة المرور فأوضح أنها لا تُستعاد لأن الرسائل مشفّرة طرفياً.';

/** يرسل سؤال المستخدم إلى Gemini ويعيد النص. لا يُخزَّن شيء على الخادم. */
export async function askAssistant(env: Env, message: string): Promise<string> {
  const key = (env as unknown as Record<string, string | undefined>).GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: message }] }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini responded ${res.status}`);

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
  return text || 'لم أتمكن من توليد رد الآن، حاول مرة أخرى.';
}
