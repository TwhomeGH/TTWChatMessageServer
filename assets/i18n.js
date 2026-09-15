(function (root) {
    'use strict';
    /** 清單同時供前後端使用；拒絕路徑、重複代碼及無效 locale。 */
    function normalizeManifest(value) {
        const languages = [], seen = new Set();
        for (const entry of Array.isArray(value?.languages) ? value.languages : []) {
            if (!entry || typeof entry.code !== 'string' || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(entry.code)
                || typeof entry.label !== 'string' || !entry.label.trim()) continue;
            try { new Intl.DateTimeFormat(entry.code); } catch { continue; }
            const identity = entry.code.toLowerCase();
            if (seen.has(identity)) continue;
            seen.add(identity); languages.push({ code: entry.code, label: entry.label.trim() });
        }
        if (!languages.some(entry => entry.code === 'zh-TW')) languages.unshift({ code: 'zh-TW', label: '繁體中文' });
        return { default: languages.some(entry => entry.code === value?.default) ? value.default : 'zh-TW', languages };
    }
    /** 缺漏、空字串依序回退中文、呼叫端預設文字、key；參數不做 HTML 解析。 */
    function translate(primary, fallback, key, params = {}, defaultText = '') {
        const valid = value => typeof value === 'string' && value.trim().length > 0;
        const own = (map, key) => Object.hasOwn(map, key) ? map[key] : undefined;
        const text = [own(primary, key), own(fallback, key), defaultText, key].find(valid);
        return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (token, name) => Object.hasOwn(params, name) ? String(params[name]) : token);
    }
    if (typeof module !== 'undefined' && module.exports) { module.exports = { translate, normalizeManifest }; return; }
    let manifest = normalizeManifest(null);
    let language = 'zh-TW', primary = {}, fallback = {}, revision = 0;
    const originals = new WeakMap();
    async function load(locale) {
        try {
            const response = await fetch('/lang/' + locale + '.json', { signal: AbortSignal.timeout(5000), cache: 'no-cache' });
            if (!response.ok) return {};
            const data = await response.json();
            return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        } catch { return {}; }
    }
    function t(key, params, defaultText) { return translate(primary, fallback, key, params, defaultText); }
    /** 只更新已標記的純文字節點，保留尚未翻譯頁面的原始內容。 */
    function apply() {
        document.documentElement.lang = language;
        document.querySelectorAll('[data-i18n]').forEach(element => {
            if (!originals.has(element)) originals.set(element, element.textContent);
            element.textContent = t(element.dataset.i18n, {}, originals.get(element));
        });
        document.querySelectorAll('[data-language-select]').forEach(select => { select.value = language; });
    }
    async function setLanguage(locale) {
        const id = ++revision;
        locale = manifest.languages.some(entry => entry.code === locale) ? locale : manifest.default;
        const tables = await Promise.all([load('zh-TW'), locale === 'zh-TW' ? Promise.resolve(null) : load(locale)]);
        if (id !== revision) return;
        language = locale;
        if (Object.keys(tables[0]).length) fallback = tables[0];
        primary = tables[1] || fallback;
        try { localStorage.setItem('ttw.language', language); } catch {}
        apply();
        document.dispatchEvent(new CustomEvent('languagechange'));
    }
    let saved;
    try { saved = localStorage.getItem('ttw.language'); } catch {}
    const api = { t, setLanguage, apply, get language() { return language; } };
    root.TTWI18n = api;
    document.querySelectorAll('[data-language-select]').forEach(select => {
        select.addEventListener('change', () => setLanguage(select.value));
    });
    root.addEventListener('storage', event => { if (event.key === 'ttw.language') setLanguage(event.newValue); });
    /** 依清單建立所有頁面選單；清單無法載入時仍提供繁體中文。 */
    api.ready = (async () => {
        manifest = normalizeManifest(await load('index'));
        document.querySelectorAll('[data-language-select]').forEach(select => {
            select.replaceChildren(...manifest.languages.map(entry => {
                const option = document.createElement('option');
                option.value = entry.code; option.textContent = entry.label;
                return option;
            }));
        });
        await setLanguage(saved);
    })();
})(typeof window === 'undefined' ? this : window);
