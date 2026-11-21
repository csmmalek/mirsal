import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Shows the error on screen instead of a blank page, so a crash can be reported and fixed.
 * Nothing is sent anywhere: the message stays on the device.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI crash', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div dir="rtl" className="min-h-screen w-full flex items-center justify-center p-6 bg-slate-100 text-slate-900">
        <div className="max-w-md w-full space-y-3 rounded-2xl bg-white p-5 shadow">
          <h1 className="text-lg font-bold">حدث خطأ في عرض التطبيق</h1>
          <p className="text-sm text-slate-600">أعد تحميل الصفحة. إذا تكرر الخطأ فأرسل نص الرسالة أدناه للمطور.</p>
          <pre dir="ltr" className="text-xs whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-red-700">
            {error.name}: {error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full min-h-[44px] rounded-xl bg-violet-600 text-white text-sm font-semibold"
          >
            إعادة التحميل
          </button>
        </div>
      </div>
    );
  }
}
