const fs = require('node:fs');
const path = require('node:path');

const LOCAL = process.env.LOCALAPPDATA || '';
const PROGRAM_FILES = process.env.PROGRAMFILES || 'C:/Program Files';
const PROGRAM_FILES_X86 = process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)';

const CANDIDATES = [
    process.env.YOUTUBE_BROWSER_PATH,
    process.env.CHROME_PATH,
    path.join(PROGRAM_FILES, 'Google/Chrome/Application/chrome.exe'),
    path.join(PROGRAM_FILES_X86, 'Google/Chrome/Application/chrome.exe'),
    path.join(LOCAL, 'Google/Chrome/Application/chrome.exe'),
    path.join(PROGRAM_FILES_X86, 'Microsoft/Edge/Application/msedge.exe'),
    path.join(PROGRAM_FILES, 'Microsoft/Edge/Application/msedge.exe'),
    path.join(LOCAL, 'Microsoft/Edge/Application/msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge'
].filter(Boolean);

/**
 * 找出 YouTube 專用瀏覽器。明確設定但不存在時直接報錯，避免默默換成其他瀏覽器。
 * @returns {string} 瀏覽器執行檔絕對路徑。
 */
function browserPath() {
    const explicit = process.env.YOUTUBE_BROWSER_PATH || process.env.CHROME_PATH;
    if (explicit) {
        const resolved = path.resolve(explicit);
        if (fs.existsSync(resolved)) return resolved;
        throw new Error(`YOUTUBE_BROWSER_PATH／CHROME_PATH 指定的瀏覽器不存在：${resolved}`);
    }
    for (const candidate of CANDIDATES) {
        if (candidate && fs.existsSync(candidate)) return candidate;
    }
    throw new Error('找不到可用的 Chrome/Edge。請設定 YOUTUBE_BROWSER_PATH。\n已檢查：\n' + CANDIDATES.join('\n'));
}

module.exports = { browserPath, CANDIDATES };
