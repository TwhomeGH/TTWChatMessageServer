import test from 'node:test';
import assert from 'node:assert/strict';
import { startYoutubeChat, stopYoutubeChat } from '../ScriptLib/youtube/chat.mjs';

test('未啟動 YouTube 時，收尾不應輸出聊天室已斷線', async () => {
    const logs = [];
    const original = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
        await startYoutubeChat('', {
            writeLog: () => {}, sendSystem: () => {}, notify: () => {},
            axios: {}, apiKey: '', pollIntervalS: 5, sendChat: () => {},
            reportTraffic: () => {}, reportFiltered: () => {}, filter: () => ({ blocked: false }),
            recordHeat: () => true, replaceEmojis: value => value, translate: async value => value,
            onViewerCount: () => {}
        });
        await stopYoutubeChat();
        await stopYoutubeChat();
    } finally {
        console.log = original;
    }
    assert.equal(logs.some(line => line.includes('Youtube 聊天室已斷線')), false);
    assert.equal(logs.some(line => line.includes('Youtube 聊天室已停止')), false);
});
