const unavailable = () => new Response('Demo service unavailable.', { status: 503, headers: { 'Cache-Control': 'no-store' } });

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.hostname === 'www.worldkinetics.app'
      || (incoming.hostname === 'worldkinetics.app' && incoming.protocol === 'http:')) {
      const canonical = new URL(incoming);
      canonical.protocol = 'https:'; canonical.host = 'worldkinetics.app'; canonical.port = '';
      return Response.redirect(canonical.href, 308);
    }
    if (incoming.pathname !== '/api' && !incoming.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.API_ORIGIN || !env.UPSTREAM_KEY) return unavailable();
    let origin;
    try {
      origin = new URL(env.API_ORIGIN);
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return unavailable();
    } catch { return unavailable(); }
    const target = new URL(origin);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const headers = new Headers();
    for (const name of ['accept', 'content-type', 'content-length', 'cookie', 'origin', 'range', 'x-worldkinetics-workspace']) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    // Cloudflare supplies this header; never trust visitor-supplied forwarding headers.
    const ip = request.headers.get('cf-connecting-ip');
    if (ip && ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(ip)) headers.set('X-WorldKinetics-Client-IP', ip);
    headers.set('X-WorldKinetics-Upstream-Key', env.UPSTREAM_KEY);
    try {
      const response = await fetch(target, {
        method: request.method, headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'manual', cache: 'no-store',
      });
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return unavailable(); }
      const outgoing = new Headers(response.headers);
      for (const name of ['X-WorldKinetics-Upstream-Key', 'X-WorldKinetics-Client-IP', 'Access-Control-Allow-Origin', 'Access-Control-Allow-Credentials']) outgoing.delete(name);
      outgoing.set('Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outgoing });
    } catch { return unavailable(); }
  },
};
