/**
 * Vercel Serverless Function — POST /api/verify-turnstile
 *
 * Verifies a Cloudflare Turnstile token server-side.
 * The secret key lives only here (server), never in the browser bundle.
 *
 * Required environment variable (set in Vercel dashboard, NOT prefixed with VITE_):
 *   TURNSTILE_SECRET_KEY=<your Cloudflare secret key>
 *
 * Returns: { success: boolean, error?: string }
 */

export const config = {
  runtime: 'edge', // Use Vercel Edge Runtime for low latency
};

export default async function handler(req) {
  // Only accept POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let token;
  try {
    const body = await req.json();
    token = body?.token;
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!token) {
    return new Response(JSON.stringify({ success: false, error: 'Missing token' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    // Not configured — allow through (dev fallback)
    return new Response(JSON.stringify({ success: true, note: 'Turnstile not configured' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify with Cloudflare
  const formData = new URLSearchParams();
  formData.append('secret', secretKey);
  formData.append('response', token);
  // Include the visitor's real IP for extra fraud signal (Vercel forwards this header)
  const clientIp = req.headers.get('x-forwarded-for') ?? '';
  if (clientIp) formData.append('remoteip', clientIp.split(',')[0].trim());

  try {
    const cfRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });
    const cfData = await cfRes.json();

    return new Response(JSON.stringify({ success: cfData.success === true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Prevent the verification result from being cached
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Verification request failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
