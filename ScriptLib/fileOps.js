// ScriptLib/fileOps.js
const { readFile, writeFile, rename, unlink } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');

/**
 * 安全讀取檔案內容
 * 如果檔案不存在，會拋出 ENOENT 錯誤
 */
async function readFileSafe(file) {
    return readFile(file, 'utf8');
}

/**
 * 原子性寫入檔案
 * 先寫入臨時檔，再 rename 成正式檔案
 * 避免寫檔中途失敗導致檔案壞掉
 */
async function writeFileAtomic(file, data) {
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
        await writeFile(temporary, data);
        await rename(temporary, file);
    } finally {
        // 確保臨時檔被清掉，即使 rename 失敗
        await unlink(temporary).catch(() => {});
    }
}

module.exports = { readFileSafe, writeFileAtomic };
