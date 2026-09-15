const fs = require('node:fs');
const path = require('node:path');

// Explicit public asset list; never map arbitrary request paths onto the disk.
function serveWebAsset(req, res) {
    if (req.url.split('?')[0] !== '/assets/app.css') return false;
    if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true;
    }
    fs.readFile(path.join(__dirname, 'assets', 'app.css'), (error, data) => {
        if (error) { res.writeHead(404); res.end('CSS asset not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        res.end(req.method === 'HEAD' ? undefined : data);
    });
    return true;
}
module.exports = { serveWebAsset };
