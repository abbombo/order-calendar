/**
 * Vercel Edge Middleware — runs at the CDN before any page loads.
 * Provides bot-blocking and basic request filtering for all routes.
 *
 * To add proper IP-based rate limiting (free tier available), integrate:
 *   npm install @upstash/ratelimit @upstash/redis
 *   and add UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN env vars.
 */

// Known bad-bot / scraper user-agent substrings to block
const BAD_BOT_PATTERNS = [
  'curl/', 'wget/', 'python-requests', 'python-urllib', 'go-http-client',
  'java/', 'libwww-perl', 'scrapy', 'semrushbot', 'ahrefsbot', 'dotbot',
  'mj12bot', 'blexbot', 'yandexbot', 'baiduspider', 'bytespider',
  'petalbot', 'applebot', 'dataforseobot', 'gptbot', 'chatgpt-user',
  'ccbot', 'claude-web', 'anthropic-ai', 'google-extended',
];

export function middleware(request) {
  const { pathname } = new URL(request.url);
  const ua = (request.headers.get('user-agent') || '').toLowerCase();

  // ── 1. Block known bad bots by user-agent on /app ────────────────────────
  if (pathname.startsWith('/app')) {
    const isKnownBot = BAD_BOT_PATTERNS.some(pattern => ua.includes(pattern));
    if (isKnownBot) {
      return new Response('Forbidden', { status: 403 });
    }

    // ── 2. Reject requests that look like raw API calls, not browser tabs ──
    // Real browsers always send Sec-Fetch-Mode on modern GET navigations
    const secFetchMode = request.headers.get('sec-fetch-mode');
    const secFetchDest = request.headers.get('sec-fetch-dest');

    // Block direct non-browser programmatic GETs to the app shell
    // (sec-fetch-mode is absent on curl/script requests but present in browsers)
    // Allow: 'navigate', 'no-cors', 'cors', undefined (for older browsers/Safari)
    // Block only when dest is 'document' but mode is explicitly 'cors' or 'no-cors'
    //   which would indicate an XHR/fetch call trying to scrape the page content
    if (secFetchMode === 'cors' && secFetchDest === 'document') {
      return new Response('Forbidden', { status: 403 });
    }
  }

  // ── 3. Block path traversal attempts ────────────────────────────────────
  if (pathname.includes('..') || pathname.includes('%2e%2e')) {
    return new Response('Bad Request', { status: 400 });
  }

  // ── 4. Block suspicious query strings (SQLi / XSS probes) ───────────────
  const searchParams = new URL(request.url).searchParams.toString();
  const suspiciousPatterns = [/<script/i, /javascript:/i, /union\s+select/i, /exec\s*\(/i];
  if (suspiciousPatterns.some(p => p.test(searchParams))) {
    return new Response('Bad Request', { status: 400 });
  }

  // All good — continue to the static asset
  return Response.next();
}

export const config = {
  // Run middleware on all routes except static assets
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png|.*\\.ico|.*\\.css|.*\\.js$).*)',
  ],
};
