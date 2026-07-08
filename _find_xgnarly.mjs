import fs from 'fs';
const c = fs.readFileSync('node_modules/tiktok-signature/server.mjs', 'utf8');
const idx = c.indexOf('export function encodeXGnarly');
if (idx >= 0) {
    // Find the function body
    let depth = 1;
    let brace = c.indexOf('{', idx);
    let j = brace + 1;
    while (depth > 0 && j < c.length) {
        if (c[j] === '{') depth++;
        if (c[j] === '}') depth--;
        j++;
    }
    const fn = c.substring(idx, j);
    console.log(fn);
} else {
    console.log('encodeXGnarly export not found');
    // Try non-export variant
    const idx2 = c.indexOf('encodeXGnarly(');
    if (idx2 >= 0) {
        const start = c.lastIndexOf('\n', idx2) + 1;
        let depth = 1;
        let brace = c.indexOf('{', idx2);
        if (brace >= 0) {
            let j = brace + 1;
            while (depth > 0 && j < c.length) {
                if (c[j] === '{') depth++;
                if (c[j] === '}') depth--;
                j++;
            }
            const fn = c.substring(start, j);
            console.log(fn);
        } else {
            console.log('No brace found for encodeXGnarly');
            console.log('Context:', c.substring(idx2, idx2 + 500));
        }
    }
}
