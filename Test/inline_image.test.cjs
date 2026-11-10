/** Inline data URI 圖片的格式、大小、數量與通知剝離。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseDataImage, validateInlineImages, stripInlineImages, isInlineImage
} = require('../ScriptLib/media/inline.cjs');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const DATA = `data:image/png;base64,${PNG.toString('base64')}`;

test('接受 png/jpeg/webp/gif，拒絕 SVG 與非 base64', () => {
    assert.equal(isInlineImage(DATA), true);
    assert.equal(parseDataImage(DATA).ok, true);
    assert.equal(parseDataImage('data:image/svg+xml;base64,AAAA').reason, 'unsupported-format');
    assert.equal(parseDataImage('data:image/png,AAAA').reason, 'unsupported-format');
    assert.equal(parseDataImage('https://x/a.png').reason, 'not-inline-image');
});

test('驗證 img／giftImg／message 的數量與總量', () => {
    const valid = validateInlineImages({ img: DATA, message: `look ${DATA} end` });
    assert.equal(valid.ok, true);
    assert.equal(valid.count, 2);
    assert.equal(valid.totalEncodedBytes, DATA.length * 2);

    const svg = validateInlineImages({ message: 'data:image/svg+xml;base64,AAAA' });
    assert.equal(svg.ok, false);
    assert.equal(svg.reason, 'unsupported-format');

    const tooMany = validateInlineImages({ message: Array.from({ length: 21 }, () => DATA).join(' ') });
    assert.equal(tooMany.ok, false);
    assert.equal(tooMany.reason, 'too-many-images');
});

test('通知文字會移除 data URI，不把 base64 當內文', () => {
    const text = `before ${DATA} after`;
    assert.equal(stripInlineImages(text), 'before after');
    assert.equal(stripInlineImages(text).includes('base64'), false);
});
