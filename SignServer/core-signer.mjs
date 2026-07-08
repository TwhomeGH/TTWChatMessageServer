/**
 * Pure Node.js X-Bogus signer
 * Loads TikTok's SDK files directly in a VM sandbox, extracts the X-Bogus
 * computation function, and makes it available without Puppeteer.
 */
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_DIR = path.resolve(__dirname, '../node_modules/tiktok-signature/javascript');

// Browser polyfills for the SDK to run in Node.js
function createSandbox() {
    const cookieStore = { msToken: '', sessionid: '' };

    const navigator = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        platform: 'MacIntel',
        language: 'en-US',
        languages: ['en-US', 'en'],
        cookieEnabled: true,
        doNotTrack: null,
        deviceMemory: 8,
        hardwareConcurrency: 8,
        maxTouchPoints: 0,
        vendor: 'Google Inc.',
        vendorSub: '',
        productSub: '20030107',
        appCodeName: 'Mozilla',
        appName: 'Netscape',
        appVersion: '5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    };

    const location = {
        href: 'https://www.tiktok.com/@zara/live',
        origin: 'https://www.tiktok.com',
        protocol: 'https:',
        host: 'www.tiktok.com',
        hostname: 'www.tiktok.com',
        port: '',
        pathname: '/@zara/live',
        search: '',
        hash: '',
    };

    const sandbox = {
        // Core
        window: {},
        self: {},
        globalThis: globalThis,
        console: console,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        setInterval: setInterval,
        clearInterval: clearInterval,
        setImmediate: setImmediate,
        clearImmediate: clearImmediate,

        // DOM-like
        document: {
            cookie: Object.entries(cookieStore).map(([k, v]) => `${k}=${v}`).join('; '),
            get cookie() {
                return Object.entries(cookieStore).map(([k, v]) => `${k}=${v}`).join('; ');
            },
            set cookie(val) {
                const match = val.match(/^([^=]+)=([^;]+)/);
                if (match) cookieStore[match[1]] = match[2];
            },
            createElement: () => ({}),
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            documentElement: {},
            body: {},
            head: {},
            createTextNode: () => ({}),
            addEventListener: () => {},
            removeEventListener: () => {},
            readyState: 'complete',
            visibilityState: 'visible',
            hidden: false,
        },

        // Navigator
        navigator: navigator,
        Navigator: function() {},

        // Location
        location: location,
        History: function() {},
        history: {
            length: 1,
            state: null,
            pushState: () => {},
            replaceState: () => {},
            go: () => {},
            back: () => {},
            forward: () => {},
            scrollRestoration: 'auto',
        },

        // Crypto
        crypto: globalThis.crypto,
        Crypto: globalThis.Crypto,
        SubtleCrypto: globalThis.SubtleCrypto,

        // Performance
        performance: globalThis.performance,
        Performance: globalThis.Performance,

        // URL (native)
        URL: URL,
        URLSearchParams: URLSearchParams,

        // Common browser APIs
        localStorage: {
            _data: {},
            getItem: (k) => localStorage._data[k] || null,
            setItem: (k, v) => { localStorage._data[k] = String(v); },
            removeItem: (k) => { delete localStorage._data[k]; },
            clear: () => { localStorage._data = {}; },
            get length() { return Object.keys(localStorage._data).length; },
            key: (i) => Object.keys(localStorage._data)[i] || null,
        },
        sessionStorage: {
            _data: {},
            getItem: (k) => sessionStorage._data[k] || null,
            setItem: (k, v) => { sessionStorage._data[k] = String(v); },
            removeItem: (k) => { delete sessionStorage._data[k]; },
            clear: () => { sessionStorage._data = {}; },
            get length() { return Object.keys(sessionStorage._data).length; },
            key: (i) => Object.keys(sessionStorage._data)[i] || null,
        },

        // Other
        screen: {
            width: 1920,
            height: 1080,
            availWidth: 1920,
            availHeight: 1040,
            colorDepth: 24,
            pixelDepth: 24,
        },
        innerWidth: 1920,
        innerHeight: 1080,
        outerWidth: 1920,
        outerHeight: 1080,
        devicePixelRatio: 1,
        pageXOffset: 0,
        pageYOffset: 0,
        scrollX: 0,
        scrollY: 0,

        // Events
        Event: function() {},
        CustomEvent: function() {},
        MouseEvent: function() {},
        KeyboardEvent: function() {},
        TouchEvent: function() {},
        Promise: Promise,
        RegExp: RegExp,
        Error: Error,
        TypeError: TypeError,
        RangeError: RangeError,
        ReferenceError: ReferenceError,
        SyntaxError: SyntaxError,
        EvalError: EvalError,
        URIError: URIError,

        // Math, Date, etc
        Math: Math,
        Date: Date,
        parseInt: parseInt,
        parseFloat: parseFloat,
        isNaN: isNaN,
        isFinite: isFinite,
        JSON: JSON,
        Object: Object,
        Array: Array,
        String: String,
        Number: Number,
        Boolean: Boolean,
        Function: Function,
        Symbol: Symbol,
        Map: Map,
        Set: Set,
        WeakMap: WeakMap,
        WeakSet: WeakSet,
        Proxy: Proxy,
        Reflect: Reflect,
        Promise: Promise,

        // Typed arrays
        ArrayBuffer: ArrayBuffer,
        Int8Array: Int8Array,
        Uint8Array: Uint8Array,
        Uint8ClampedArray: Uint8ClampedArray,
        Int16Array: Int16Array,
        Uint16Array: Uint16Array,
        Int32Array: Int32Array,
        Uint32Array: Uint32Array,
        Float32Array: Float32Array,
        Float64Array: Float64Array,
        BigInt64Array: BigInt64Array,
        BigUint64Array: BigUint64Array,
        DataView: DataView,
        Buffer: Buffer,
        TextEncoder: TextEncoder,
        TextDecoder: TextDecoder,

        // Other
        atob: atob,
        btoa: btoa,
        encodeURI: encodeURI,
        encodeURIComponent: encodeURIComponent,
        decodeURI: decodeURI,
        decodeURIComponent: decodeURIComponent,

        // placeholder for SDK results
        __sdkN: undefined,
        byted_acrawler: undefined,
        _mssdk: undefined,
    };

    // self -> window
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.globalThis = globalThis;

    // window.window -> window
    sandbox.window.window = sandbox.window;
    sandbox.window.self = sandbox.window;

    return sandbox;
}

let signerReady = false;
let signFn = null;

export async function initSigner() {
    if (signerReady) return true;

    const sdk485Path = path.join(SDK_DIR, 'webmssdk_2.0.0.485.js');
    const sdk513Path = path.join(SDK_DIR, 'webmssdk_5.1.3.js');
    const sdk368Path = path.join(SDK_DIR, 'webmssdk_1.0.0.368.js');

    console.log('[CoreSigner] Loading SDK files...');

    try {
        const sdk485 = fs.readFileSync(sdk485Path, 'utf-8');
        const sdk513 = fs.readFileSync(sdk513Path, 'utf-8');

        const sandbox = createSandbox();
        const context = vm.createContext(sandbox);

        console.log('[CoreSigner] Evaluating v5.1.3 SDK (byted_acrawler)...');
        vm.runInContext(sdk513, context, { timeout: 10000, filename: 'webmssdk_5.1.3.js' });

        console.log('[CoreSigner] Evaluating v2.0.0 SDK (__sdkN)...');
        vm.runInContext(sdk485, context, { timeout: 10000, filename: 'webmssdk_2.0.0.485.js' });

        // Extract SDK objects
        const sdkN = context.__sdkN;
        const acrawler = context.byted_acrawler;

        if (!sdkN) throw new Error('__sdkN not initialized');
        if (!acrawler) throw new Error('byted_acrawler not initialized');

        console.log('[CoreSigner] SDK loaded: __sdkN=' + !!sdkN + ', byted_acrawler=' + !!acrawler);

        // Extract u995 from the version table
        let table = null;
        if (sdkN.u && sdkN.u[995] && sdkN.u[995].v) table = sdkN.u;
        else if (sdkN.B && sdkN.B.o && sdkN.B.o[995] && sdkN.B.o[995].v) table = sdkN.B.o;
        else if (sdkN.o && sdkN.o[995] && sdkN.o[995].v) table = sdkN.o;

        if (!table) throw new Error('Cannot find version table (995) in __sdkN');

        const u995 = table[995] && table[995].v;
        if (typeof u995 !== 'function') throw new Error('u995 is not a function');

        console.log('[CoreSigner] u995 function extracted');

        signFn = (queryString) => {
            const xb = u995.call(acrawler, queryString, '');
            return xb;
        };

        signerReady = true;
        return true;
    } catch (err) {
        console.error('[CoreSigner] Initialization failed:', err.message);
        return false;
    }
}

export function signQuery(queryString) {
    if (!signFn) throw new Error('Signer not initialized. Call initSigner() first.');
    return signFn(queryString);
}
