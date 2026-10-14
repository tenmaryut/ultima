import type { Plugin } from 'vite';

/**
 * Injects a Content-Security-Policy meta tag into index.html for production builds.
 * Dev builds skip it because Vite's HMR client relies on inline scripts.
 */
export function cspPlugin(target: 'desktop' | 'web'): Plugin {
  let isBuild = false;
  return {
    name: 'ultima-csp',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    transformIndexHtml(html) {
      if (!isBuild) return html;
      const connect =
        target === 'desktop'
          ? "'self' blob: data:"
          : "'self' blob: data: http://127.0.0.1:* http://localhost:*";
      const csp = [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' data: blob:",
        "font-src 'self' data:",
        `connect-src ${connect}`,
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ].join('; ');
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
  };
}
