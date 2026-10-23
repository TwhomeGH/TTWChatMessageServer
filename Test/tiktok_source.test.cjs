const test = require('node:test');
const assert = require('node:assert/strict');
const { tiktokChatSource } = require('../ScriptLib/tiktok/source.cjs');

test('TikTok 聊天來源 auto 會依簽名設定選擇，也可明確指定', () => {
    assert.equal(tiktokChatSource({}), 'browser');
    assert.equal(tiktokChatSource({ SIGN_API_KEY: 'key' }), 'native');
    assert.equal(tiktokChatSource({ TIKTOK_COOKIES: 'sessionid=x' }), 'native');
    assert.equal(tiktokChatSource({ DIRECT_SIGNER_ENABLED: '1' }), 'native');
    assert.equal(tiktokChatSource({ TIKTOK_CHAT_SOURCE: 'browser', SIGN_API_KEY: 'key' }), 'browser');
    assert.equal(tiktokChatSource({ TIKTOK_CHAT_SOURCE: 'native' }), 'native');
    assert.equal(tiktokChatSource({ TIKTOK_CHAT_SOURCE: 'auto' }), 'browser');
    assert.equal(tiktokChatSource({ TIKTOK_CHAT_SOURCE: 'invalid' }), 'browser');
});
