# Changelog

## Unreleased: Android wake-up, offline outbox, phone setup help

### Arabic
- `android/.../PollService.java`: إيقاظ فوري لاستطلاع الإشعارات عند عودة الشبكة عبر `ConnectivityManager.NetworkCallback`، مع إعادة الفاصل إلى 20 ثانية وفاصل أدنى ثانيتين بين الطلبات. إلغاء التسجيل عند إيقاف الخدمة.
- `src/utils/outbox.ts` و`src/utils/outbox.test.ts` (جديدان): صندوق رسائل صادرة مشفّرة بمفتاح لكل مستخدم، بحد 50 رسالة وحد 200 ألف حرف للنص المشفّر.
- `src/App.tsx`: حفظ الرسالة المشفّرة نفسها عند فشل مؤقت (انقطاع، 408، 429، 5xx)، وإعادة إرسالها تلقائياً عند عودة الاتصال أو فتح WebSocket أو تسجيل الدخول أو ظهور التبويب، وكل 30 ثانية كاحتياط. الرسائل الفاشلة لا تختفي عند تحديث القائمة.
- `src/components/ChatWorkspace.tsx`: نص «سيُرسل تلقائياً عند عودة الاتصال» للرسائل المؤجلة.
- `src/types/chat.ts`: حقل `queued` في `Message`.
- `src/components/DevModals.tsx`: لوحة «لتصل الإشعارات بسرعة» تظهر على أندرويد فقط.

### English
- `android/.../PollService.java`: wake the poll loop immediately when the network returns, using `ConnectivityManager.NetworkCallback`. Resets the backoff to 20 s, enforces a 2 s minimum gap between polls, and unregisters on destroy.
- `src/utils/outbox.ts` and `outbox.test.ts` (new): encrypted outbox keyed per user id, capped at 50 items and 200k characters of ciphertext.
- `src/App.tsx`: store the exact encrypted message on transient failure (network error, 408, 429, 5xx) and resend on `online`, WebSocket open, login/session restore, tab visibility, and every 30 s as a fallback. Failed messages are kept when the list reloads.
- `src/components/ChatWorkspace.tsx`: "will be sent automatically" label for queued messages.
- `src/types/chat.ts`: `queued` field on `Message`.
- `src/components/DevModals.tsx`: Android-only phone setup help panel.
