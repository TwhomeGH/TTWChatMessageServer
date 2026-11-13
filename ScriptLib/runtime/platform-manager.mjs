/**
 * 執行中平台啟動器：同一平台只啟動一次，狀態經 callback 回報給主服務。
 * 平台啟動邏輯仍由呼叫端注入，管理器只負責冪等、狀態與失敗重試。
 */

/**
 * @param {Object} options
 * @param {Record<string, () => Promise<string>|string>} options.starts 平台名稱 → 啟動函式。
 * @param {(platform: string, state: string, error?: string) => void} [options.report]
 * @param {(platform: string) => void} [options.onStart] 啟動前設定平台旗標。
 * @param {(message: string) => void} [options.log]
 * @returns {{add: (platform: string) => Promise<{ok: boolean, state: string, reason?: string}>, has: (platform: string) => boolean, list: () => string[]}}
 */
export function createPlatformManager({ starts, report = () => {}, onStart = () => {}, log = () => {} } = {}) {
    const started = new Set();

    async function add(platform) {
        const name = String(platform || '').trim().toLowerCase();
        if (!starts || typeof starts[name] !== 'function') {
            report(name, 'failed', '不支援的平台');
            return { ok: false, state: 'failed', reason: 'unsupported' };
        }
        if (started.has(name)) {
            report(name, 'running');
            return { ok: false, state: 'running', reason: 'already-running' };
        }
        started.add(name);
        onStart(name);
        report(name, 'starting');
        try {
            const state = await starts[name]();
            report(name, state || 'running');
            return { ok: true, state: state || 'running' };
        } catch (error) {
            started.delete(name);
            report(name, 'failed', error.message || String(error));
            log(`[PLATFORM] ${name} 啟動失敗: ${error.message || error}`);
            throw error;
        }
    }

    return {
        add,
        has: platform => started.has(String(platform || '').trim().toLowerCase()),
        list: () => [...started]
    };
}
