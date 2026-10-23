const test = require('node:test');
const assert = require('node:assert/strict');
const { youtubeChatSource } = require('../ScriptLib/youtube/source.cjs');

test('YouTube 聊天來源只接受 auto／native／browser／manual', () => {
    assert.equal(youtubeChatSource({}), 'auto');
    assert.equal(youtubeChatSource({ YOUTUBE_CHAT_SOURCE: 'native' }), 'native');
    assert.equal(youtubeChatSource({ YOUTUBE_CHAT_SOURCE: 'browser' }), 'browser');
    assert.equal(youtubeChatSource({ YOUTUBE_CHAT_SOURCE: 'manual' }), 'manual');
    assert.equal(youtubeChatSource({ YOUTUBE_CHAT_SOURCE: 'invalid' }), 'auto');
});
