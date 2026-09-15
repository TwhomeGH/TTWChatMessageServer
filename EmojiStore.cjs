// 表情映射的狀態、熱載入與序列化修改入口。
const path = require('node:path');
const { validate, ValidationError } = require('./ScriptLib/validate');
const { revision } = require('./ScriptLib/revision');
const { readFileSafe, writeFileAtomic } = require('./ScriptLib/fileOps');

class EmojiStore {

    /**
    * 建立新的 EmojiStore
    * @param {string} file - JSON 檔案路徑
    */
    constructor(file) {
        this.file = file;
        this.map = {};
        this.error = null;
        this.loaded = false;
        this.pending = Promise.resolve();
        this.timer = null;
    }


    /**
    * 將動作加入佇列，確保非同步操作不會互相衝突
    * @param {Function} action - 要執行的非同步函式
    * @returns {Promise<any>} - 佇列化後的 Promise
    */
    enqueue(action) {
        const next = this.pending.then(action);
        this.pending = next.catch(() => { });
        return next;
    }


    /**
     * 從檔案讀取並驗證 emoji 對應表
     * @returns {Promise<void>}
     * @throws {ValidationError|Error} - 當檔案不存在或格式錯誤
     */
    async read() {
        try {
            const content = await readFileSafe(this.file);
            const map = validate(JSON.parse(content));
            this.map = map;
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
    }

    /**
     * 載入對應表（包裝成佇列動作）
     * @returns {Promise<void>}
     */
    load() {
        return this.enqueue(() => this.read());
    }

    /**
     * 取得目前狀態快照
     * @returns {{map:Object, revision:string, error:string|null}}
     */
    snapshot() {
        return {
            map: { ...this.map },
            revision: revision(this.map),
            error: this.error
        };
    }

    /**
     * 啟動定時監看檔案變化
     * @returns {Function} - 停止監看的函式
     */
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
     * 修改對應表（新增/刪除），並安全寫回檔案
     * @param {Object} action - 修改動作
     * @param {string} action.operation - 'save' 或 'delete'
     * @param {string} action.code - emoji 代碼
     * @param {string} [action.url] - 圖片網址（save 時必填）
     * @param {string} [action.originalCode] - 原始代碼（編輯時用）
     * @param {string} action.revision - 呼叫端的版本雜湊，用來檢查衝突
     * @returns {Promise<{map:Object, revision:string, error:string|null}>}
     * @throws {ValidationError|Error} - 當驗證失敗或版本衝突
     */
    change(action) {
        return this.enqueue(async () => {
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
                if (action.originalCode && action.originalCode !== action.code) {
                    delete next[action.originalCode];
                }
                Object.defineProperty(next, action.code, {
                    value: action.url, enumerable: true, configurable: true, writable: true
                });
            } else {
                throw new Error('不支援的操作');
            }

            validate(next);
            await writeFileAtomic(this.file, JSON.stringify(next, null, 4) + '\n');

            this.map = next;
            this.loaded = true;
            this.error = null;
            return this.snapshot();
        });
    }
}

// 每個程序共用一份狀態；測試可自行建立獨立實例。
const store = new EmojiStore(path.join(__dirname, 'emoji_map.json'));
module.exports = { EmojiStore, store, validate };
