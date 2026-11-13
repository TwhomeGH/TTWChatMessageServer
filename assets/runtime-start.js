(() => {
    const i18n = window.TTWI18n, box = document.getElementById('launch-options');
    const launch = document.getElementById('launch'), reset = document.getElementById('reset-options');
    const error = document.getElementById('launch-error'), key = 'ttw.runtime.options';
    let options = [], state = null, busy = false;
    const addCard = document.getElementById('runtime-add-card');
    const addList = document.getElementById('runtime-add-platforms');
    const addStatus = document.getElementById('runtime-add-status');
    const transportCard = document.getElementById('runtime-transport-card');
    const transportList = document.getElementById('runtime-transport-list');
    const transportStatus = document.getElementById('runtime-transport-status');
    const platformKeys = { isTK: 'tiktok', isTwitch: 'twitch', isKick: 'kick', isOdysee: 'odysee', isYouTube: 'youtube' };
    const transportKeys = [
        { key: 'socket', label: 'Socket／overlay', configured: 'socketConfigured' },
        { key: 'bark', label: 'Bark', configured: 'barkConfigured' },
        { key: 'ntfy', label: 'ntfy', configured: 'ntfyConfigured' }
    ];
    function toast(message, tone = 'info') { window.runtimeToast?.(message, tone); }
    /** 僅讀寫白名單欄位；儲存不可用時仍能在當頁啟動。 */
    function values() {
        const result = {};
        for (const option of options) {
            result[option.key] = document.getElementById('option-' + option.key).checked;
            if (option.account) result[option.account] = document.getElementById('option-' + option.account).value;
        }
        return result;
    }
    function save() { try { localStorage.setItem(key, JSON.stringify(values())); } catch (err) { console.warn('無法儲存啟動選項:', err?.message || err); } }
    function addPlatform(platform) {
        if (busy) return;
        busy = true;
        addStatus.textContent = '';
        fetch('/api/runtime/platforms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform })
        }).then(async response => {
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw Error(i18n.t('error.' + result.code, {}, result.error || '加開失敗'));
            toast(i18n.t('runtime.addPlatformSent', {platform}, '已送出加開 {platform} 要求'), 'success');
            await window.runtimeRefresh?.(false);
        }).catch(failure => {
            addStatus.textContent = failure.message;
            toast(i18n.t('runtime.addPlatformFailed', {message:failure.message}, '加開失敗：{message}'), 'error');
        }).finally(() => { busy = false; renderTransports(state); renderAddPlatforms(state); });
    }

    function setTransport(key, enabled) {
        if (busy) return;
        busy = true;
        transportStatus.textContent = '';
        fetch('/api/runtime/transports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [key]: enabled })
        }).then(async response => {
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw Error(i18n.t('error.' + result.code, {}, result.error || '切換失敗'));
            toast(i18n.t('runtime.transportUpdated', { key }, '已更新 {key}'), 'success');
            await window.runtimeRefresh?.(false);
        }).catch(failure => {
            transportStatus.textContent = failure.message;
            toast(i18n.t('runtime.transportFailed', { message: failure.message }, '切換失敗：{message}'), 'error');
        }).finally(() => { busy = false; renderTransports(state); renderAddPlatforms(state); });
    }

    function transportStateText(item, transports) {
        const active = transports[item.key] === true;
        const configured = transports[item.configured] === true;
        if (!configured) return i18n.t('runtime.transportUnconfigured', {}, '未設定');
        if (!active) return i18n.t('runtime.transportOff', {}, '關閉');
        if (item.key === 'socket') {
            return transports.socketConnected
                ? i18n.t('runtime.transportConnected', {}, '已連線')
                : i18n.t('runtime.transportConnecting', {}, '連線中');
        }
        return i18n.t('runtime.transportOn', {}, '開啟');
    }

    function renderTransports(next) {
        if (!transportCard || !transportList) return;
        const running = next && ['running', 'starting'].includes(next.state);
        transportCard.hidden = !running;
        if (!running) return;
        const transports = next.transports || {};
        const rows = transportKeys.map(item => {
            const configured = transports[item.configured] === true;
            const active = transports[item.key] === true;
            const row = document.createElement('div');
            row.className = 'flex items-center gap-2 px-3 py-2 border border-gray-700 rounded-lg';
            const status = document.createElement('span');
            status.className = 'text-sm text-gray-300';
            status.textContent = item.label + '：' + transportStateText(item, transports);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'runtime-button runtime-button-secondary';
            button.disabled = busy || !configured;
            button.textContent = i18n.t(active ? 'runtime.transportTurnOff' : 'runtime.transportTurnOn',
                { name: item.label }, active ? '關閉 ' + item.label : '開啟 ' + item.label);
            button.addEventListener('click', () => setTransport(item.key, !active));
            row.append(status, button);
            return row;
        });
        transportList.replaceChildren(...rows);
    }

    function renderAddPlatforms(next) {
        if (!addCard || !addList) return;
        const running = next && ['running', 'starting'].includes(next.state);
        addCard.hidden = !running;
        if (!running) return;
        const active = new Set((next.platforms || []).map(value => String(value).toLowerCase()));
        const failed = next.platformErrors || {};
        const errors = Object.entries(failed);
        addStatus.textContent = errors.length
            ? errors.map(([platform, message]) => `${platform}: ${message}`).join(' · ')
            : '';
        const candidates = options.filter(option => option.group === 'platforms');
        const buttons = [];
        for (const option of candidates) {
            const platform = platformKeys[option.key];
            if (!platform || (active.has(platform) && !failed[platform])) continue;
            const retry = Boolean(failed[platform]);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'runtime-button runtime-button-secondary';
            button.textContent = retry
                ? i18n.t('runtime.retryPlatformButton', { platform: option.label }, '重新加開 ' + option.label)
                : i18n.t('runtime.addPlatformButton', { platform: option.label }, '加開 ' + option.label);
            button.disabled = busy;
            button.addEventListener('click', () => addPlatform(platform));
            buttons.push(button);
        }
        if (!buttons.length) {
            const done = document.createElement('span');
            done.className = 'text-sm text-gray-400';
            done.textContent = i18n.t('runtime.allPlatformsActive', {}, '所有已設定的平台都已在本次執行中。');
            buttons.push(done);
        }
        addList.replaceChildren(...buttons);
    }

    function update(next) {
        state = next;
        const locked = busy || !state || !['stopped', 'failed'].includes(state.state) || !options.length;
        box.disabled = locked; reset.disabled = locked;
        launch.disabled = locked || !options.some(o => document.getElementById('option-' + o.key).checked);
        const active = state?.features ? options.filter(o => o.group === 'transport' && state.features[o.key]).map(o => o.label) : [];
        document.getElementById('active-features').textContent = active.length
            ? i18n.t('runtime.activeFeatures', {}, '本次功能：') + active.join(', ') : '';
        renderTransports(state);
        renderAddPlatforms(state);
    }
    /** 平台名稱與欄位由後端提供；所有文字使用 textContent。 */
    async function init() {
        try {
            const response = await fetch('/api/runtime/options');
            if (!response.ok) throw Error(i18n.t('runtime.optionsError', {}, '無法載入啟動選項'));
            options = (await response.json()).options;
            let saved = {}; try { saved = JSON.parse(localStorage.getItem(key)) || {}; } catch (err) { console.warn('無法讀取啟動選項:', err?.message || err); }
            for (const option of options) {
                const row = document.createElement('div'), label = document.createElement('label');
                row.className = 'runtime-option';
                label.className = 'runtime-option-label';
                const input = document.createElement('input'); input.type = 'checkbox'; input.id = 'option-' + option.key;
                input.checked = typeof saved[option.key] === 'boolean' ? saved[option.key] : option.default;
                label.append(input, document.createTextNode(option.label)); row.append(label);
                if (option.account) {
                    const account = document.createElement('input'); account.type = 'text'; account.id = 'option-' + option.account;
                    account.maxLength = 200; account.setAttribute('aria-label', option.label + ' account / channel');
                    account.className = 'runtime-account';
                    account.value = typeof saved[option.account] === 'string' ? saved[option.account].slice(0, 200) : '';
                    account.hidden = !input.checked;
                    input.addEventListener('change', () => { account.hidden = !input.checked; }); row.append(account);
                }
                document.getElementById('launch-' + option.group).append(row);
            }
            update(state);
        } catch (failure) {
            error.textContent = failure.message;
            toast(failure.message, 'error');
        }
    }
    box.addEventListener('input', () => { save(); update(state); });
    reset.onclick = () => {
        for (const option of options) {
            document.getElementById('option-' + option.key).checked = option.default;
            if (option.account) { const input = document.getElementById('option-' + option.account); input.value = ''; input.hidden = !option.default; }
        }
        save(); update(state);
        toast(i18n.t('runtime.toast.reset', {}, '已恢復預設啟動選項'), 'info');
    };
    launch.onclick = async () => {
        if (launch.disabled) return;
        busy = true; save(); update(state); error.textContent = '';
        try {
            const response = await fetch('/api/runtime/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values()) });
            const result = await response.json();
            if (!response.ok) throw Error(i18n.t('error.' + result.code, {}, result.error));
            state = result;
            toast(i18n.t('runtime.toast.started', {}, '已送出啟動要求'), 'success');
        } catch (failure) {
            error.textContent = failure.message;
            toast(i18n.t('runtime.toast.startFailed', {message: failure.message}, '啟動失敗：{message}'), 'error');
        }
        finally { busy = false; update(state); window.runtimeRefresh?.(false); }
    };
    window.runtimeStart = { update };
    document.addEventListener('languagechange', () => update(state));
    i18n.ready.then(init);
})();
