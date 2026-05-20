/**
 * Simple in-memory rate limiter for auth endpoints.
 * Resets on server restart. For production, use Redis-backed rate limiting.
 */

interface RateLimitEntry {
  readonly count: number;
  readonly resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

/**
 * Check and record a rate limit attempt.
 * @param key      Unique key (e.g. "login:192.168.1.1")
 * @param maxRequests Maximum allowed requests in the window
 * @param windowMs  Window size in milliseconds
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  store.set(key, { count: entry.count + 1, resetAt: entry.resetAt });
  return { allowed: true };
}
