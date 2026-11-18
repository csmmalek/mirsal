/**
 * طبقة API الموحّدة: ترويسة الدخول، ومعالجة 401، ورسائل أخطاء عربية واضحة.
 * كل المكوّنات تستخدم readError / ApiError من هنا بدل النسخ المكررة.
 */

export class ApiError extends Error {
  /** رمز الحالة HTTP، أو 0 عند انقطاع الشبكة. */
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** رسالة عربية مناسبة لرمز الحالة عندما لا يرسل الخادم رسالة خاصة. */
export function messageForStatus(status: number, fallback = 'حدث خطأ غير متوقع'): string {
  switch (status) {
    case 0:
      return 'تعذر الاتصال بالخادم، تحقق من اتصال الإنترنت وحاول مجدداً';
    case 400:
      return 'طلب غير صالح';
    case 401:
      return 'انتهت الجلسة، سجّل الدخول مجدداً';
    case 403:
      return 'غير مصرح لك بهذا الإجراء';
    case 404:
      return 'غير موجود';
    case 409:
      return 'تعارض مع بيانات موجودة';
    case 413:
      return 'الحجم كبير جداً';
    case 415:
      return 'نوع الملف غير مدعوم';
    case 429:
      return 'محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة';
    default:
      return status >= 500 ? 'حدث خطأ في الخادم، حاول لاحقاً' : fallback;
  }
}

/** يقرأ رسالة الخطأ من استجابة فاشلة (يفضّل رسالة الخادم، ثم رسالة الحالة، ثم fallback). */
export async function readError(res: Response, fallback = 'حدث خطأ غير متوقع'): Promise<string> {
  try {
    const d = (await res.json()) as { error?: unknown };
    if (typeof d.error === 'string' && d.error) return d.error;
  } catch {
    /* الاستجابة ليست JSON */
  }
  return messageForStatus(res.status, fallback);
}

/** يحوّل أي خطأ التقطه catch إلى نص عربي يمكن عرضه للمستخدم. */
export function errorMessage(err: unknown, fallback = 'حدث خطأ غير متوقع'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return messageForStatus(0);
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export type ApiFn = (path: string, init?: RequestInit) => Promise<Response>;

interface ApiOptions {
  getToken: () => string | null;
  /** يُستدعى عند 401 لطلب غير مصادقة (انتهاء الجلسة). */
  onUnauthorized: () => void;
}

/**
 * يبني دالة api لها نفس توقيع fetch: تضيف Content-Type وAuthorization،
 * وتحوّل انقطاع الشبكة إلى ApiError(status 0) برسالة عربية.
 */
export function createApi({ getToken, onUnauthorized }: ApiOptions): ApiFn {
  return async (path, init = {}) => {
    const token = getToken();
    let res: Response;
    try {
      res = await fetch(path, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch {
      throw new ApiError(messageForStatus(0), 0);
    }
    if (res.status === 401 && token && !path.startsWith('/api/auth/')) onUnauthorized();
    return res;
  };
}

/** يرمي ApiError إن كانت الاستجابة فاشلة، وإلا يعيد JSON. */
export async function jsonOrThrow<T>(res: Response, fallback?: string): Promise<T> {
  if (!res.ok) throw new ApiError(await readError(res, fallback), res.status);
  return (await res.json()) as T;
}
