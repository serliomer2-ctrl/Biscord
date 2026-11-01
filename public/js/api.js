// REST API istemcisi
let token = null;
try { token = localStorage.getItem('bis:token'); } catch { /* depolama yok */ }

export const api = {
  get token() { return token; },
  setToken(t) {
    token = t;
    try { t ? localStorage.setItem('bis:token', t) : localStorage.removeItem('bis:token'); } catch { /* yok say */ }
  },
  async req(method, url, body) {
    const opts = { method, headers: {} };
    if (token) opts.headers.Authorization = token;
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch('/api' + url, opts); } catch { throw new Error('Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `İstek başarısız (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get: (u) => api.req('GET', u),
  post: (u, b) => api.req('POST', u, b ?? {}),
  patch: (u, b) => api.req('PATCH', u, b ?? {}),
  put: (u, b) => api.req('PUT', u, b ?? {}),
  del: (u) => api.req('DELETE', u),
};
