/** The developer account. It is reserved: registering this email needs the ADMIN_SETUP_CODE secret. */
export const ADMIN_EMAIL = 'zmalqpgg7777@gmail.com';

export function isAdminEmail(email: unknown): boolean {
  return typeof email === 'string' && email.trim().toLowerCase() === ADMIN_EMAIL;
}
