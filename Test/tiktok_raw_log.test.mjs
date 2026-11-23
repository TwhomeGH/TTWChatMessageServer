import test from 'node:test';
import assert from 'node:assert/strict';
import { logRawEvent } from '../ScriptLib/tiktok/rawLog.mjs';

test('MEMBER raw log 保留進場來源、action、wave 與互動摘要', () => {
    const lines = [];
    logRawEvent('MEMBER', {
        common: { msgId: 'm1' },
        user: {
            nickname: 'Alice', displayId: 'alice', id: 'u1',
            isSubscribe: true, isFollower: true, isFollowing: false
        },
        operator: { id: 'u2', nickname: 'Mod' },
        memberCount: 42,
        enterType: 7,
        action: 3,
        actionDescription: 'subscribed',
        clientEnterSource: 'recommend',
        clientEnterType: 'draw',
        clientLiveReason: 'for-you',
        userShareType: 'link',
        kickSource: 2,
        hitAbStatus: 1,
        displayStyle: 1,
        waveAlgorithmData: { isAlgHit: true, isRewatch: false, predictScore: '0.9' },
        publicAreaMessageCommon: {
            isAnchorMarked: true,
            userInteractionInfo: { likeCnt: '3', commentCnt: '2', shareCnt: '1' }
        }
    }, { log: line => lines.push(line) });

    assert.equal(lines.length, 1);
    const info = JSON.parse(lines[0].slice('[RAW] '.length));
    assert.equal(info.event, 'MEMBER');
    assert.equal(info.member.enterType, 7);
    assert.equal(info.member.action, 3);
    assert.equal(info.member.clientEnterSource, 'recommend');
    assert.equal(info.member.clientEnterType, 'draw');
    assert.equal(info.member.clientLiveReason, 'for-you');
    assert.equal(info.member.waveAlgorithmData.isAlgHit, true);
    assert.equal(info.member.publicAreaMessageCommon.userInteractionInfo.commentCnt, '2');
    assert.equal(info.member.operator.nickname, 'Mod');
    assert.equal(info.user.isSubscribe, true);
    assert.equal(info.user.isFollower, true);
    assert.equal(info.user.isFollowing, false);
});

test('RAW log 截短過長字串，避免單一欄位洗版', () => {
    const lines = [];
    logRawEvent('MEMBER', { clientEnterSource: 'x'.repeat(500) }, { log: line => lines.push(line) });
    const info = JSON.parse(lines[0].slice('[RAW] '.length));
    assert.equal(info.member.clientEnterSource.length, 201);
    assert.ok(info.member.clientEnterSource.endsWith('…'));
});
