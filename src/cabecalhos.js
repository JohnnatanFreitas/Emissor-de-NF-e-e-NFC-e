// Cabeçalhos de segurança. Os mesmos valores estão no vercel.json (páginas do front servidas pela
// Vercel); o teste test/seguranca.test.js confere que os dois não se separam.

/** Telas do sistema (front React): só o próprio site carrega scripts, estilos, fontes e dados. */
export const CSP_SITE = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Respostas da API (JSON, XML): não são páginas, nada deve rodar nelas. */
export const CSP_API = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * DANFE (HTML para imprimir). Roda isolado (sandbox, origem opaca): mesmo que um texto da nota
 * trouxesse código, ele não alcançaria a sessão nem a API. Só o botão Imprimir usa script.
 */
export const CSP_DANFE = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'; sandbox allow-scripts allow-modals; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export const CABECALHOS_COMUNS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};

export const HSTS = "max-age=63072000; includeSubDomains";

/** Aplica os cabeçalhos em toda resposta do servidor Node (API e, sem Vercel, o front). */
export function registrarCabecalhos(app, { https }) {
  app.addHook("onSend", async (req, reply, corpo) => {
    for (const [k, v] of Object.entries(CABECALHOS_COMUNS)) reply.header(k, v);
    if (https) reply.header("strict-transport-security", HSTS);
    const api = req.url.startsWith("/api/");
    if (!reply.hasHeader("content-security-policy")) {
      reply.header("content-security-policy", api ? CSP_API : CSP_SITE + (https ? "; upgrade-insecure-requests" : ""));
    }
    // Dados fiscais e de sessão nunca ficam em cache (navegador, proxy ou CDN).
    if (api) reply.header("cache-control", "no-store");
    return corpo;
  });
}
