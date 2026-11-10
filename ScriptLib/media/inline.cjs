/**
 * Inline data URI 圖片驗證。這不是 URL 快取：data URI 由 App 本機解碼，
 * 伺服器只檢查格式與 encoded 大小，不抓取、不切片、不改寫。
 */
const crypto = require('node:crypto');
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 768 * 1024;
const MAX_COUNT = 20;
const DATA_URI_RE = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}/gi;

function isInlineImage(value) {
    return typeof value === 'string' && /^data:image\//i.test(value);
}

/**
 * @param {string} value
 * @returns {{ok: true, mime: string, encodedBytes: number, payload: string}|{ok:false, reason:string}}
 */
function parseDataImage(value) {
    if (typeof value !== 'string') return { ok: false, reason: 'not-string' };
    if (!isInlineImage(value)) return { ok: false, reason: 'not-inline-image' };
    const match = value.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i);
    if (!match) return { ok: false, reason: 'unsupported-format' };
    const mime = match[1].toLowerCase();
    if (!ALLOWED_MIME.has(mime)) return { ok: false, reason: 'unsupported-format' };
    const encodedBytes = Buffer.byteLength(value, 'utf8');
    if (!match[2].length || match[2].length % 4 === 1) return { ok: false, reason: 'invalid-base64' };
    return { ok: true, mime, encodedBytes, payload: match[2] };
}

/** 解碼已驗證的 data URI；供歷史 materialize 使用，不做外部請求。 */
function decodeDataImage(value) {
    const parsed = parseDataImage(value);
    if (!parsed.ok) return parsed;
    if (parsed.encodedBytes > MAX_IMAGE_BYTES) return { ok: false, reason: 'image-too-large' };
    const payload = parsed.payload + '='.repeat((-parsed.payload.length) % 4);
    const body = Buffer.from(payload, 'base64');
    if (!body.length) return { ok: false, reason: 'empty-image' };
    return {
        ok: true, mime: parsed.mime, body,
        hash: crypto.createHash('sha256').update(body).digest('hex')
    };
}

/** 從文字抽出所有 data image URI（包含不支援的 MIME，讓驗證層回報）。 */
function extractDataImages(text) {
    if (typeof text !== 'string') return [];
    return text.match(DATA_URI_RE) || [];
}

/** 移除文字中的 data image URI，主要供 Bark／ntfy 通知使用。 */
function stripInlineImages(text) {
    if (typeof text !== 'string') return text;
    return text.replace(DATA_URI_RE, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * 驗證單則訊息的 img／giftImg／message 內嵌圖片。
 * @param {{img?:string,giftImg?:string,message?:string}} fields
 * @returns {{ok:boolean, reason?:string, count:number, totalEncodedBytes:number, images:Array}}
 */
function validateInlineImages({ img = '', giftImg = '', message = '' } = {}) {
    const values = [];
    for (const value of [img, giftImg]) {
        if (isInlineImage(value)) values.push(value);
    }
    values.push(...extractDataImages(message));
    let totalEncodedBytes = 0;
    const images = [];
    for (const value of values) {
        const parsed = parseDataImage(value);
        if (!parsed.ok) return { ok: false, reason: parsed.reason, count: values.length, totalEncodedBytes, images };
        if (parsed.encodedBytes > MAX_IMAGE_BYTES) {
            return { ok: false, reason: 'image-too-large', count: values.length, totalEncodedBytes, images };
        }
        totalEncodedBytes += parsed.encodedBytes;
        images.push(parsed);
        if (images.length > MAX_COUNT) {
            return { ok: false, reason: 'too-many-images', count: images.length, totalEncodedBytes, images };
        }
        if (totalEncodedBytes > MAX_TOTAL_BYTES) {
            return { ok: false, reason: 'total-too-large', count: images.length, totalEncodedBytes, images };
        }
    }
    return { ok: true, count: images.length, totalEncodedBytes, images };
}

module.exports = {
    ALLOWED_MIME, MAX_IMAGE_BYTES, MAX_TOTAL_BYTES, MAX_COUNT,
    isInlineImage, parseDataImage, decodeDataImage, extractDataImages, stripInlineImages, validateInlineImages
};
