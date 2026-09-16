// 表情映射管理頁面邏輯。
// 從 /api/emoji 載入映射表，提供搜尋、預覽、新增、編輯、刪除；
// 儲存後由伺服器端約 1 秒套用至新訊息，此頁只負責送出變更並重新渲染清單。

let mapping = {};
let revision = '';
let originalCode = null;
let busy = false;

const el = id => document.getElementById(id);

// 狀態列文字。
function setStatus(text) {
    el('status').textContent = text;
}

// 解析並驗證圖片網址：僅允許 http/https，回傳正規化後的網址，否則 null。
// 預覽時使用正規化結果，避免把原始輸入直接寫進 DOM 的 URL 屬性。
function parseImageUrl(value) {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
}

// 網址的短雜湊（djb2），僅作為圖片快取的 cache-busting：網址一改，key 就換。
function shortHash(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
    return h.toString(36);
}

// 重設表單為「新增」狀態。
function resetForm() {
    originalCode = null;
    el('editor').reset();
    el('editorTitle').textContent = '新增映射';
    el('preview').hidden = true;
    el('previewStatus').textContent = '';
}

// 建立單一映射卡片：縮圖、代碼、網址、編輯與刪除。
function createCard(code, url) {
    const card = document.createElement('article');
    card.className = 'bg-gray-900 rounded-lg p-3 flex gap-3';

    const image = document.createElement('img');
    // 走伺服器端快取路由（依代碼取圖）；v 讓網址變更時繞過瀏覽器快取。
    image.src = '/emoji/image?code=' + encodeURIComponent(code) + '&v=' + shortHash(url);
    image.alt = code;
    image.width = 48;
    image.height = 48;
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.className = 'object-contain w-12 h-12';

    const body = document.createElement('div');
    body.className = 'flex-1 min-w-0';

    const name = document.createElement('p');
    name.textContent = code;
    name.className = 'font-semibold break-all';

    const address = document.createElement('p');
    address.textContent = url;
    address.className = 'text-xs text-gray-400 break-all';

    image.onerror = () => {
        image.hidden = true;
        address.textContent = '圖片無法載入 · ' + url;
    };

    const actions = document.createElement('div');
    actions.className = 'flex gap-3 mt-2';

    const edit = document.createElement('button');
    edit.textContent = '編輯';
    edit.disabled = busy;
    edit.onclick = () => startEdit(code, url);

    const remove = document.createElement('button');
    remove.textContent = '刪除';
    remove.className = 'text-red-300';
    remove.disabled = busy;
    remove.onclick = () => {
        if (confirm('刪除 ' + code + ' 的映射？')) mutate({ operation: 'delete', code });
    };

    actions.append(edit, remove);
    body.append(name, address, actions);
    card.append(image, body);
    return card;
}

// 依搜尋字串過濾並重新渲染映射清單。
function render() {
    el('list').replaceChildren();
    const query = el('search').value.toLowerCase();
    const entries = Object.entries(mapping).filter(([code, url]) => (code + ' ' + url).toLowerCase().includes(query));
    el('count').textContent = entries.length + ' / ' + Object.keys(mapping).length + ' 筆';
    for (const [code, url] of entries) el('list').append(createCard(code, url));
    if (!entries.length) el('list').textContent = '沒有符合的映射';
}

// 將某筆映射載入表單進行編輯。
function startEdit(code, url) {
    originalCode = code;
    el('code').value = code;
    el('url').value = url;
    el('editorTitle').textContent = '編輯 ' + code;
    el('preview').hidden = true;
    el('previewStatus').textContent = '';
    el('code').focus();
}

// 呼叫 API；非 2xx 或 success=false 時丟出錯誤訊息。
async function request(options) {
    const res = await fetch('/api/emoji', options);
    const data = await res.json();
    if (!res.ok || !data.success) throw Error(data.error || '請求失敗');
    return data;
}

// 載入映射表；伺服器解析失敗時會回報 error 並保留上一版。
async function load() {
    try {
        const data = await request();
        mapping = data.map;
        revision = data.revision;
        render();
        setStatus(data.error ? '檔案格式錯誤，保留上一版：' + data.error : '已載入；外部檔案變更可按重新載入查看。');
    } catch (error) {
        setStatus(error.message);
    }
}

// 送出新增／編輯／刪除；期間鎖定按鈕避免重複送出。
async function mutate(action) {
    if (busy) return;
    busy = true;
    el('save').disabled = true;
    el('reload').disabled = true;
    render();
    try {
        const data = await request({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...action, revision })
        });
        mapping = data.map;
        revision = data.revision;
        resetForm();
        setStatus('已儲存，約 1 秒後套用至新訊息。');
    } catch (error) {
        setStatus(error.message);
    } finally {
        busy = false;
        el('save').disabled = false;
        el('reload').disabled = false;
        render();
    }
}

// 預覽輸入的圖片網址。
function previewImage() {
    const url = parseImageUrl(el('url').value);
    if (!url) {
        setStatus('請填寫完整 HTTP(S) 圖片網址');
        return;
    }
    el('previewStatus').textContent = '載入中';
    el('preview').hidden = false;
    el('preview').onload = () => { el('previewStatus').textContent = '預覽成功'; };
    el('preview').onerror = () => {
        el('preview').hidden = true;
        el('previewStatus').textContent = '圖片無法載入';
    };
    el('preview').src = url;
}

// 表單送出：新增或更新映射。
function onSubmit(event) {
    event.preventDefault();
    const raw = el('url').value;
    if (!parseImageUrl(raw)) {
        setStatus('請填寫完整 HTTP(S) 圖片網址');
        return;
    }
    mutate({ operation: 'save', code: el('code').value, url: raw, originalCode });
}

// 事件綁定與初始載入。
el('editor').onsubmit = onSubmit;
el('previewBtn').onclick = previewImage;
el('cancel').onclick = resetForm;
el('reload').onclick = load;
el('search').oninput = render;
load();
