import { promises as fs } from 'fs';
import path from 'path';

const EMOJI_MAP_FILE = path.resolve('./emoji_map.json');
let emojiMap = {};

export async function loadEmojiMap(filePath = EMOJI_MAP_FILE) {
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        emojiMap = JSON.parse(raw);
        console.log(`✅ 載入 ${Object.keys(emojiMap).length} 筆表情對應`);
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log('⚠️ emoji_map.json 不存在，使用空對應表');
            emojiMap = {};
        } else {
            console.error('❌ 載入 emoji_map.json 失敗:', err);
            emojiMap = {};
        }
    }
}

export function replaceEmojis(text) {
    if (!text || typeof text !== 'string') return text;
    let result = text;
    for (const [code, url] of Object.entries(emojiMap)) {
        const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'g');
        if (regex.test(result)) {
            result = result.replace(regex, url);
        }
    }
    return result;
}

export function getEmojiMap() {
    return { ...emojiMap };
}

export function addEmoji(code, url) {
    emojiMap[code] = url;
}

export function removeEmoji(code) {
    delete emojiMap[code];
}

export async function saveEmojiMap(filePath = EMOJI_MAP_FILE) {
    const sorted = Object.fromEntries(
        Object.entries(emojiMap).sort(([a], [b]) => a.localeCompare(b))
    );
    await fs.writeFile(filePath, JSON.stringify(sorted, null, 4), 'utf-8');
}

export default {
    loadEmojiMap,
    replaceEmojis,
    getEmojiMap,
    addEmoji,
    removeEmoji,
    saveEmojiMap,
};
