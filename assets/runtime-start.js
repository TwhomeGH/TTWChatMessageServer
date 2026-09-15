(() => {
    const i18n = window.TTWI18n, box = document.getElementById('launch-options');
    const launch = document.getElementById('launch'), reset = document.getElementById('reset-options');
    const error = document.getElementById('launch-error'), key = 'ttw.runtime.options';
    let options = [], state = null, busy = false;
    /** 僅讀寫白名單欄位；儲存不可用時仍能在當頁啟動。 */
    function values() {
        const result = {};
        for (const option of options) {
            result[option.key] = document.getElementById('option-' + option.key).checked;
            if (option.account) result[option.account] = document.getElementById('option-' + option.account).value;
        }
        return result;
    }
    function save() { try { localStorage.setItem(key, JSON.stringify(values())); } catch {} }
    function update(next) {
        state = next;
        const locked = busy || !state || !['stopped', 'failed'].includes(state.state) || !options.length;
        box.disabled = locked; reset.disabled = locked;
        launch.disabled = locked || !options.some(o => document.getElementById('option-' + o.key).checked);
        document.getElementById('active-features').textContent = state?.features
            ? i18n.t('runtime.activeFeatures', {}, '本次功能：') + ['Socket', 'Bark'].filter((name, i) => state.features[i ? 'isBark' : 'isSocket']).join(', ') : '';
    }
    /** 平台名稱與欄位由後端提供；所有文字使用 textContent。 */
    async function init() {
        try {
            const response = await fetch('/api/runtime/options');
            if (!response.ok) throw Error(i18n.t('runtime.optionsError', {}, '無法載入啟動選項'));
            options = (await response.json()).options;
            let saved = {}; try { saved = JSON.parse(localStorage.getItem(key)) || {}; } catch {}
            for (const option of options) {
                const row = document.createElement('div'), label = document.createElement('label');
                const input = document.createElement('input'); input.type = 'checkbox'; input.id = 'option-' + option.key;
                input.checked = typeof saved[option.key] === 'boolean' ? saved[option.key] : option.default;
                label.append(input, document.createTextNode(' ' + option.label)); row.append(label);
                if (option.account) {
                    const account = document.createElement('input'); account.type = 'text'; account.id = 'option-' + option.account;
                    account.maxLength = 200; account.setAttribute('aria-label', option.label + ' account / channel');
                    account.className = 'bg-gray-700 rounded p-2 w-full mt-2';
                    account.value = typeof saved[option.account] === 'string' ? saved[option.account].slice(0, 200) : '';
                    account.hidden = !input.checked;
                    input.addEventListener('change', () => { account.hidden = !input.checked; }); row.append(account);
                }
                document.getElementById('launch-' + option.group).append(row);
            }
            update(state);
        } catch (failure) { error.textContent = failure.message; }
    }
    box.addEventListener('input', () => { save(); update(state); });
    reset.onclick = () => {
        for (const option of options) {
            document.getElementById('option-' + option.key).checked = option.default;
            if (option.account) { const input = document.getElementById('option-' + option.account); input.value = ''; input.hidden = !option.default; }
        }
        save(); update(state);
    };
    launch.onclick = async () => {
        if (launch.disabled) return;
        busy = true; save(); update(state); error.textContent = '';
        try {
            const response = await fetch('/api/runtime/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values()) });
            const result = await response.json();
            if (!response.ok) throw Error(i18n.t('error.' + result.code, {}, result.error));
            state = result;
        } catch (failure) { error.textContent = failure.message; }
        finally { busy = false; update(state); document.getElementById('refresh').click(); }
    };
    window.runtimeStart = { update };
    document.addEventListener('languagechange', () => update(state));
    i18n.ready.then(init);
})();
