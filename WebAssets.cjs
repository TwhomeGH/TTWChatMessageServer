const fs = require('node:fs');
const path = require('node:path');
const { normalizeManifest } = require('./assets/i18n.js');

/** 建立靜態資源路由；語系每次讀取清單，新增語言後重新整理即可使用。 */
function createWebAssetHandler(root = __dirname) {
    return function serveWebAsset(req, res) {
        const files = {
            '/assets/app.css': ['assets/app.css', 'text/css; charset=utf-8'],
            '/assets/runtime-start.js': ['assets/runtime-start.js', 'text/javascript; charset=utf-8'],
            '/assets/i18n.js': ['assets/i18n.js', 'text/javascript; charset=utf-8']
        };
        const pathname = req.url.split('?')[0];
        const locale = /^\/lang\/([a-zA-Z0-9-]+)\.json$/.exec(pathname)?.[1];
        if (!Object.hasOwn(files, pathname) && !locale) return false;
        if (!['GET', 'HEAD'].includes(req.method)) {
            res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true;
        }
        function send(status, body, contentType = 'application/json; charset=utf-8') {
            res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
            res.end(req.method === 'HEAD' ? undefined : body);
        }
        function read(file, contentType) {
            fs.readFile(path.join(root, file), (error, data) => {
                if (error) send(404, 'Asset not found', 'text/plain; charset=utf-8');
                else send(200, data, contentType);
            });
        }
        if (locale) {
            fs.readFile(path.join(root, 'lang/index.json'), 'utf8', (error, text) => {
                let data;
                try { data = error ? null : JSON.parse(text); } catch {}
                const manifest = normalizeManifest(data);
                if (locale === 'index') send(200, JSON.stringify(manifest));
                else if (manifest.languages.some(entry => entry.code === locale)) read('lang/' + locale + '.json');
                else send(404, 'Asset not found', 'text/plain; charset=utf-8');
            });
        } else read(...files[pathname]);
        return true;
    };
}
module.exports = { serveWebAsset: createWebAssetHandler(), createWebAssetHandler };
