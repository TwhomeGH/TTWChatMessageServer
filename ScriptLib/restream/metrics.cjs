const MAX_SHOWS = 20;
const MAX_SAMPLES = 120;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const shows = new Map();

const numberIn = (value, min, max) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
};

function normalizeValues(values = {}) {
    const health = typeof values?.health === 'string' ? values.health.trim().slice(0, 40) || null : null;
    const resolution = typeof values?.resolution === 'string' && /^\d{2,5}x\d{2,5}$/i.test(values.resolution.trim())
        ? values.resolution.trim().toLowerCase() : null;
    return {
        health,
        resolution,
        bitrateKbps: numberIn(values?.bitrateKbps, 0, 1000000),
        fps: numberIn(values?.fps, 0, 240),
        keyframeSec: numberIn(values?.keyframeSec, 0, 60)
    };
}

function sourceUrl(value) {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'app.restream.io'
            ? url.origin + url.pathname : null;
    } catch { return null; }
}

/** 驗證並正規化一筆 Restream 指標；錯誤回傳 { error }。 */
function normalize(payload, now = Date.now()) {
    if (!payload || typeof payload !== 'object') return { error: 'INVALID_PAYLOAD' };
    const showId = typeof payload.showId === 'string' ? payload.showId.trim() : '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(showId)) return { error: 'INVALID_SHOW_ID' };
    const capturedAt = Number.isFinite(payload.capturedAt) && payload.capturedAt > 0 ? payload.capturedAt : now;
    return {
        ok: true,
        entry: {
            showId,
            values: normalizeValues(payload.values),
            capturedAt: Math.min(capturedAt, now + 60000),
            sourceUrl: sourceUrl(payload.sourceUrl),
            receivedAt: now
        }
    };
}

function prune(now = Date.now()) {
    for (const [showId, item] of shows) {
        item.samples = item.samples.filter(sample => now - sample.receivedAt <= MAX_AGE_MS);
        if (!item.samples.length) {
            shows.delete(showId);
            continue;
        }
        item.latest = item.samples[item.samples.length - 1];
    }
}

/** 記錄一筆指標；每場保留最新一筆與最近 120 筆。 */
function record(payload, now = Date.now()) {
    const result = normalize(payload, now);
    if (result.error) return result;
    prune(now);
    let item = shows.get(result.entry.showId);
    if (!item) {
        item = { showId: result.entry.showId, latest: result.entry, samples: [] };
        shows.set(result.entry.showId, item);
        while (shows.size > MAX_SHOWS) {
            const oldest = [...shows.values()].sort((a, b) => a.latest.receivedAt - b.latest.receivedAt)[0];
            shows.delete(oldest.showId);
        }
    }
    item.samples.push(result.entry);
    if (item.samples.length > MAX_SAMPLES) item.samples.splice(0, item.samples.length - MAX_SAMPLES);
    item.latest = result.entry;
    return result;
}

/** 查詢單場最新值與最近樣本；沒有資料時 latest 為 null。 */
function snapshot(showId, now = Date.now()) {
    prune(now);
    const item = shows.get(showId);
    return {
        showId,
        latest: item?.latest || null,
        samples: item?.samples.slice(-60) || [],
        sampleCount: item?.samples.length || 0
    };
}

/** 列出所有場次的最新值，最近收到者在前。 */
function list(now = Date.now()) {
    prune(now);
    return [...shows.values()]
        .map(item => ({ showId: item.showId, latest: item.latest, sampleCount: item.samples.length }))
        .sort((a, b) => b.latest.receivedAt - a.latest.receivedAt);
}

function clear() { shows.clear(); }

module.exports = { record, snapshot, list, clear, normalize, normalizeValues, MAX_SAMPLES };
