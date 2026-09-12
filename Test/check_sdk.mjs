import fs from 'fs';
const c = fs.readFileSync('node_modules/tiktok-signature/javascript/webmssdk_5.1.3.js', 'utf8');
console.log('has __sdkN:', c.includes('__sdkN'));
console.log('has byted_acrawler:', c.includes('byted_acrawler'));
console.log('has sdkN:', c.includes('sdkN'));
// find window assignment patterns
const lines = c.split('\n').filter(l => l.includes('window') && (l.includes('=') || l.includes('[')));
for (let i = 0; i < Math.min(20, lines.length); i++) {
  console.log('line:', lines[i].substring(0, 120));
}
// count total lines
console.log('total lines:', lines.length);
