import configModule from './config.cjs';

/**
 * 連接使用者啟動的瀏覽器，只追蹤自己建立的分頁。
 * 不關閉瀏覽器；斷線清除狀態，下一次請求可重新連接。
 */
export class BrowserSession {
    constructor(connect, config = configModule.browserConfig()) {
        this.connectBrowser = connect;
        this.config = config;
        this.browser = null;
        this.pending = null;
        this.pages = new Set();
        this.generation = 0;
    }

    /** 合併同時連線請求；單次失敗後允許下一次重試。 */
    async connect() {
        if (this.browser?.connected) return this.browser;
        if (this.pending) return this.pending;
        const generation = this.generation;
        this.pending = Promise.resolve().then(() => this.connectBrowser({
            browserURL: this.config.browserURL, defaultViewport: null, protocolTimeout: 15000
        })).then(async browser => {
            if (generation !== this.generation) {
                await browser.disconnect();
                throw new Error('瀏覽器連線已取消');
            }
            this.browser = browser;
            browser.once('disconnected', () => {
                if (this.browser === browser) {
                    this.browser = null;
                    this.pages.clear();
                }
            });
            return browser;
        }).finally(() => { this.pending = null; });
        return this.pending;
    }

    /** 在預設持久化 context 建立工作頁，沿用登入 Cookie。 */
    async newPage() {
        const generation = this.generation;
        const browser = await this.connect();
        const page = await browser.newPage();
        if (generation !== this.generation) {
            await page.close();
            throw new Error('分頁建立已取消');
        }
        this.pages.add(page);
        page.once('close', () => this.pages.delete(page));
        return page;
    }

    /** 僅關閉本 session 建立的分頁，保留使用者視窗及登入資料。 */
    async disconnect() {
        this.generation++;
        await Promise.allSettled([...this.pages].map(page => page.close()));
        this.pages.clear();
        const browser = this.browser;
        this.browser = null;
        await browser?.disconnect();
    }
}
