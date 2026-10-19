import test from 'node:test';
import assert from 'node:assert/strict';
import { broadcasterForPlatform } from '../ScriptLib/traffic/attribution.mjs';

const identities = {
    tiktokName: 'Streamer',
    twitchUser: '123456',
    kickName: 'KickName',
    odyseeName: 'OdyseeName',
    youtubeName: 'UCabcDEF'
};

test('每個平台使用自己的主播識別，不互相借用', () => {
    assert.equal(broadcasterForPlatform('TikTok', identities), 'streamer');
    assert.equal(broadcasterForPlatform('Twitch', identities), '123456');
    assert.equal(broadcasterForPlatform('Kick', identities), 'kickname');
    assert.equal(broadcasterForPlatform('Odysee', identities), 'odyseename');
    assert.equal(broadcasterForPlatform('Youtube', identities), 'ucabcdef');
});

test('缺少設定、空字串或未知平台都不猜測主播', () => {
    assert.equal(broadcasterForPlatform('TikTok', {}), undefined);
    assert.equal(broadcasterForPlatform('Kick', { kickName: '   ' }), undefined);
    assert.equal(broadcasterForPlatform('Twitch', { twitchUser: null }), undefined);
    assert.equal(broadcasterForPlatform('TikTok', { tiktokName: 42 }), undefined);
    assert.equal(broadcasterForPlatform('Unknown', identities), undefined);
    assert.equal(broadcasterForPlatform(undefined, identities), undefined);
});
