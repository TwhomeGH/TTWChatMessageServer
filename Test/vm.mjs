import fs from 'fs';
import vm from 'vm';

const c = fs.readFileSync('node_modules/tiktok-signature/javascript/webmssdk_5.1.3.js', 'utf-8');

const cookieStore = {};
const sandbox = {
    window: {},
    self: {},
    globalThis: globalThis,
    console: console,
    setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate,
    crypto: globalThis.crypto, Crypto: globalThis.Crypto, SubtleCrypto: globalThis.SubtleCrypto,
    performance: globalThis.performance,
    URL, URLSearchParams,
    Math, Date, JSON, Object, Array, String, Number, Boolean, Function,
    Error, TypeError, RangeError, ReferenceError, SyntaxError, EvalError,
    parseInt, parseFloat, isNaN, isFinite,
    Symbol, Map, Set, WeakMap, WeakSet, Proxy, Reflect, Promise, RegExp,
    ArrayBuffer, Int8Array, Uint8Array, Uint8ClampedArray,
    Int16Array, Uint16Array, Int32Array, Uint32Array,
    Float32Array, Float64Array, BigInt64Array, BigUint64Array,
    DataView, Buffer, TextEncoder, TextDecoder,
    atob, btoa, encodeURI, encodeURIComponent, decodeURI, decodeURIComponent,
    document: {
        cookie: '',
        get cookie() { return Object.entries(cookieStore).map(([k,v])=>k+'='+v).join('; '); },
        set cookie(val) { const m=val.match(/^([^=]+)=([^;]+)/); if(m) cookieStore[m[1]]=m[2]; },
        createElement: () => ({}), getElementById: () => null,
        querySelector: () => null, querySelectorAll: () => [],
        documentElement: {}, body: {}, createTextNode: () => ({}),
        addEventListener: () => {}, removeEventListener: () => {},
        readyState: 'complete', visibilityState: 'visible', hidden: false,
    },
    navigator: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        platform: 'MacIntel', language: 'en-US', languages: ['en-US', 'en'],
        cookieEnabled: true, hardwareConcurrency: 8, maxTouchPoints: 0,
        vendor: 'Google Inc.', appVersion: '5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    location: {
        href: 'https://www.tiktok.com/@zara/live',
        origin: 'https://www.tiktok.com', protocol: 'https:',
        host: 'www.tiktok.com', hostname: 'www.tiktok.com',
        pathname: '/@zara/live', search: '', hash: '',
    },
    screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24 },
    innerWidth: 1920, innerHeight: 1080,
    localStorage: { _d:{}, getItem(k){return this._d[k]||null}, setItem(k,v){this._d[k]=String(v)}, removeItem(k){delete this._d[k]}, clear(){this._d={}} },
    sessionStorage: { _d:{}, getItem(k){return this._d[k]||null}, setItem(k,v){this._d[k]=String(v)}, removeItem(k){delete this._d[k]}, clear(){this._d={}} },
    __sdkN: undefined,
    byted_acrawler: undefined,
    dwInfl: {},
};
sandbox.window = sandbox;
sandbox.self = sandbox;

try {
    vm.runInContext(c, vm.createContext(sandbox), { timeout: 5000 });
    console.log('SDK loaded!');
    console.log('has __sdkN:', !!sandbox.__sdkN);
    console.log('has byted_acrawler:', !!sandbox.byted_acrawler);
    console.log('byted keys:', Object.keys(sandbox.byted_acrawler || {}).slice(0,10));
} catch(e) {
    console.log('Error:', e.message);
    const stack = e.stack || '';
    const sline = stack.split('\n').find(l => l.includes('webmssdk') || l.includes('evalmachine'));
    console.log('In:', sline || stack.substring(0,300));
}
