// 表情映射的狀態、熱載入與序列化修改入口。
// 預設檔（emoji_map.json）只讀；本機覆寫（emoji_map_local.json）保存 url／enabled。
const path = require('node:path');
const { validate, ValidationError } = require('./ScriptLib/validate');
const { revision } = require('./ScriptLib/revision');
const { readFileSafe, writeFileAtomic } = require('./ScriptLib/fileOps');

const emptyLocal = () => ({ version: 1, emojis: {} });
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const validateCode = code => {
    if (!code.trim() || code.length > 200) throw new ValidationError('表情代碼不可空白，最長 200 字元');
};
const validateUrl = (code, url) => {
    validate(Object.fromEntries([[code, url]]));
};
const sortedLocal = local => Object.fromEntries(
    Object.entries(local.emojis)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, item]) => {
            const entry = {};
            if (item.url !== undefined) entry.url = item.url;
            if (item.enabled !== undefined) entry.enabled = item.enabled;
            return [code, entry];
        })
);

/** 解析預設檔；支援簡單 {code:url} 與 {version:2,emojis:{code:{url,enabled}}}。 */
function parseDefaults(text) {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new ValidationError('預設映射必須是 JSON 物件');
    }
    if (data.emojis && typeof data.emojis === 'object' && !Array.isArray(data.emojis)) {
        const entries = {};
        for (const [code, item] of Object.entries(data.emojis)) {
            validateCode(code);
            if (typeof item === 'string') {
                validateUrl(code, item);
                entries[code] = { url: item, enabled: true };
                continue;
            }
            if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.url !== 'string') {
                throw new ValidationError('預設項目需要圖片網址');
            }
            validateUrl(code, item.url);
            if (item.enabled !== undefined && typeof item.enabled !== 'boolean') {
                throw new ValidationError('enabled 必須是布林值');
            }
            entries[code] = { url: item.url, enabled: item.enabled !== false };
        }
        return entries;
    }
    const map = validate(data);
    return Object.fromEntries(Object.entries(map).map(([code, url]) => [code, { url, enabled: true }]));
}

/** 解析本機覆寫；格式為 {version:1, emojis:{code:{url?, enabled?}}}。 */
function parseLocal(text) {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new ValidationError('本機映射必須是 JSON 物件');
    }
    if (data.version !== undefined && data.version !== 1) {
        throw new ValidationError('不支援的本機映射版本');
    }
    if (!data.emojis || typeof data.emojis !== 'object' || Array.isArray(data.emojis)) {
        throw new ValidationError('本機映射需要 emojis 物件');
    }
    const emojis = {};
    for (const [code, item] of Object.entries(data.emojis)) {
        validateCode(code);
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new ValidationError('本機項目必須是物件');
        }
        const entry = {};
        if (item.url !== undefined) {
            if (typeof item.url !== 'string') throw new ValidationError('圖片網址格式錯誤');
            validateUrl(code, item.url);
            entry.url = item.url;
        }
        if (item.enabled !== undefined) {
            if (typeof item.enabled !== 'boolean') throw new ValidationError('enabled 必須是布林值');
            entry.enabled = item.enabled;
        }
        if (!hasOwn(entry, 'url') && !hasOwn(entry, 'enabled')) {
            throw new ValidationError('本機項目至少需要 url 或 enabled');
        }
        emojis[code] = entry;
    }
    return { version: 1, emojis };
}

/** 合併預設與本機狀態；回傳完整 entries 與實際使用的 map。 */
function merge(defaults, local) {
    const entries = new Map();
    for (const [code, base] of Object.entries(defaults)) {
        entries.set(code, {
            code, url: base.url, enabled: base.enabled !== false,
            source: 'default', isDefault: true, overridden: false
        });
    }
    for (const [code, item] of Object.entries(local.emojis)) {
        const base = entries.get(code);
        if (base) {
            const entry = { ...base, overridden: true };
            if (item.url !== undefined) {
                entry.url = item.url;
                entry.source = 'override';
            }
            if (item.enabled !== undefined) entry.enabled = item.enabled;
            entries.set(code, entry);
        } else {
            if (item.url === undefined) throw new ValidationError('自訂代碼需要圖片網址');
            entries.set(code, {
                code, url: item.url, enabled: item.enabled !== false,
                source: 'local', isDefault: false, overridden: true
            });
        }
    }
    const list = [...entries.values()];
    const map = {};
    for (const entry of list) {
        if (entry.enabled && entry.url) map[entry.code] = entry.url;
    }
    return { entries: list, map };
}

class EmojiStore {

    /**
     * @param {string} file 預設映射檔
     * @param {string|null} localFile 本機覆寫檔；null 時維持舊單檔模式
     */
    constructor(file, localFile = null) {
        this.file = file;
        this.localFile = localFile;
        this.defaults = {};
        this.local = emptyLocal();
        this.map = {};
        this.entries = [];
        this.error = null;
        this.loaded = false;
        this.pending = Promise.resolve();
        this.timer = null;
    }

    enqueue(action) {
        const next = this.pending.then(action);
        this.pending = next.catch(() => { });
        return next;
    }

    /** 從檔案讀取並驗證；雙檔模式下任一檔案失敗都保留上一版。 */
    async read() {
        if (!this.localFile) {
            try {
                const content = await readFileSafe(this.file);
                const map = validate(JSON.parse(content));
                this.map = map;
                this.entries = Object.entries(map).map(([code, url]) => ({
                    code, url, enabled: true, source: 'default', isDefault: true, overridden: false
                }));
                this.defaults = Object.fromEntries(Object.entries(map).map(([code, url]) => [code, { url, enabled: true }]));
                this.loaded = true;
                this.error = null;
            } catch (error) {
                if (error.code === 'ENOENT' && !this.loaded) {
                    this.error = null;
                    return;
                }
                this.error = error.message;
                throw error;
            }
            return;
        }

        try {
            const defaultText = await readFileSafe(this.file).catch(error => {
                if (error.code === 'ENOENT') return null;
                throw error;
            });
            const localText = await readFileSafe(this.localFile).catch(error => {
                if (error.code === 'ENOENT') return null;
                throw error;
            });
            const defaults = defaultText === null ? {} : parseDefaults(defaultText);
            const local = localText === null ? emptyLocal() : parseLocal(localText);
            const merged = merge(defaults, local);
            this.defaults = defaults;
            this.local = local;
            this.entries = merged.entries;
            this.map = merged.map;
            this.loaded = true;
            this.error = null;
        } catch (error) {
            this.error = error.message;
            throw error;
        }
    }

    load() {
        return this.enqueue(() => this.read());
    }

    currentRevision() {
        return this.localFile
            ? revision({ version: 1, defaults: this.defaults, local: sortedLocal(this.local) })
            : revision(this.map);
    }

    snapshot() {
        return {
            map: { ...this.map },
            entries: this.entries.map(entry => ({ ...entry })),
            revision: this.currentRevision(),
            error: this.error
        };
    }

    /** 取得指定代碼的圖片網址；包含已停用項目，供管理頁預覽。 */
    imageUrl(code) {
        const entry = this.entries.find(item => item.code === code);
        return entry?.url || this.map[code] || null;
    }

    watch() {
        if (!this.timer) {
            this.timer = setInterval(() => this.load().catch(() => { }), 1000);
            this.timer.unref();
        }
        return () => {
            clearInterval(this.timer);
            this.timer = null;
        };
    }

    /**
     * 修改映射；雙檔模式只寫本機覆寫，預設檔永不改寫。
     * @param {Object} action 修改動作
     * @returns {Promise<Object>}
     */
    change(action) {
        return this.enqueue(() => this.localFile ? this.changeLayered(action) : this.changeLegacy(action));
    }

    async changeLegacy(action) {
        await this.read();
        if (action.revision !== revision(this.map)) {
            const error = new Error('對應表已被其他操作更新，請重新載入後再儲存');
            error.status = 409;
            throw error;
        }
        const next = { ...this.map };
        if (action.operation === 'delete') {
            delete next[action.code];
        } else if (action.operation === 'save') {
            if (action.originalCode !== action.code && Object.hasOwn(next, action.code)) {
                throw new ValidationError('此代碼已存在，請使用編輯功能');
            }
            if (action.originalCode && action.originalCode !== action.code) delete next[action.originalCode];
            Object.defineProperty(next, action.code, {
                value: action.url, enumerable: true, configurable: true, writable: true
            });
        } else {
            throw new Error('不支援的操作');
        }
        validate(next);
        await writeFileAtomic(this.file, JSON.stringify(next, null, 4) + '\n');
        this.map = next;
        this.defaults = Object.fromEntries(Object.entries(next).map(([code, url]) => [code, { url, enabled: true }]));
        this.entries = Object.entries(next).map(([code, url]) => ({
            code, url, enabled: true, source: 'default', isDefault: true, overridden: false
        }));
        this.loaded = true;
        this.error = null;
        return this.snapshot();
    }

    async changeLayered(action) {
        await this.read();
        if (action.revision !== this.currentRevision()) {
            const error = new Error('對應表已被其他操作更新，請重新載入後再儲存');
            error.status = 409;
            throw error;
        }
        const local = { version: 1, emojis: Object.fromEntries(Object.entries(this.local.emojis).map(([code, item]) => [code, { ...item }])) };
        const code = typeof action.code === 'string' ? action.code : '';
        const operation = action.operation;

        if (operation === 'save') {
            validateCode(code);
            if (typeof action.url !== 'string') throw new ValidationError('請填寫圖片網址');
            validateUrl(code, action.url);
            const original = typeof action.originalCode === 'string' ? action.originalCode : null;
            if (original && original !== code && this.entries.some(entry => entry.code === code)) {
                throw new ValidationError('此代碼已存在，請使用編輯功能');
            }
            if (original && original !== code) {
                if (hasOwn(this.defaults, original)) local.emojis[original] = { enabled: false };
                else delete local.emojis[original];
            }
            if (hasOwn(this.defaults, code) && this.defaults[code].url === action.url) {
                delete local.emojis[code];
            } else {
                // enabled 預設為 true；只在需要覆寫時保存 url。
                local.emojis[code] = { url: action.url };
            }
        } else if (operation === 'set-enabled') {
            if (typeof action.enabled !== 'boolean') throw new ValidationError('enabled 必須是布林值');
            const entry = this.entries.find(item => item.code === code);
            if (!entry) throw new ValidationError('找不到此表情');
            if (hasOwn(this.defaults, code)) {
                const item = { ...(local.emojis[code] || {}) };
                if (action.enabled) {
                    delete item.enabled;
                    if (hasOwn(item, 'url')) local.emojis[code] = item;
                    else delete local.emojis[code];
                } else {
                    item.enabled = false;
                    local.emojis[code] = item;
                }
            } else {
                const item = local.emojis[code];
                if (!item || item.url === undefined) throw new ValidationError('自訂代碼需要圖片網址');
                if (action.enabled) local.emojis[code] = { url: item.url };
                else local.emojis[code] = { url: item.url, enabled: false };
            }
        } else if (operation === 'reset') {
            const entry = this.entries.find(item => item.code === code);
            if (!entry) throw new ValidationError('找不到此表情');
            delete local.emojis[code];
        } else if (operation === 'delete') {
            if (hasOwn(this.defaults, code)) throw new ValidationError('預設項目請使用停用');
            delete local.emojis[code];
        } else {
            throw new Error('不支援的操作');
        }

        const merged = merge(this.defaults, local);
        const sorted = JSON.stringify({ version: 1, emojis: sortedLocal(local) }, null, 4) + '\n';
        await writeFileAtomic(this.localFile, sorted);
        this.local = local;
        this.entries = merged.entries;
        this.map = merged.map;
        this.loaded = true;
        this.error = null;
        return this.snapshot();
    }
}

// 每個程序共用一份狀態；測試可自行建立獨立實例。
const store = new EmojiStore(
    path.join(__dirname, 'emoji_map.json'),
    path.join(__dirname, 'emoji_map_local.json')
);
module.exports = { EmojiStore, store, validate };
