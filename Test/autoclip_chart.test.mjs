import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../assets/autoclip.js', import.meta.url), 'utf8');
new vm.Script(script);
const context = {};
vm.createContext(context);
vm.runInContext(script.slice(script.indexOf('function compactScoreSeries('), script.indexOf('function scoreDuration(')), context);
vm.runInContext(script.slice(script.indexOf('function groupTriggerPoints('), script.indexOf('function showTriggerGroup(')), context);
const compact = rows => context.compactScoreSeries(rows, row => row.score, true);
const rows = (scores, interval = 5000) => scores.map((score, i) => ({ t: new Date(1700000000000 + i * interval).toISOString(), score }));

test('normal plateau without triggers retains both ends and its complete duration', () => {
    const input = rows(Array(181).fill(1.2));
    const result = compact(input);
    assert.equal(result.length, 2);
    assert.equal(result[1].x - result[0].x, 900000);
    assert.ok(result.every(p => !p.isolated));
    assert.equal(input.length, 181);
});

test('single sample and isolated samples remain visible', () => {
    assert.equal(compact(rows([0]))[0].isolated, true);
    const result = compact(rows([1, null, 2]));
    assert.equal(result.filter(p => p.y !== null && p.isolated).length, 2);
});

test('first high score retains a visible endpoint before dropping to a plateau', () => {
    const result = compact(rows([2.25, 1, 1, 1], 30000));
    assert.equal(result[0].y, 2.25);
    assert.equal(result[0].endpoint, true);
    assert.equal(result[0].isolated, false);
    assert.equal(result[1].changed, true);
    assert.equal(result.at(-1).endpoint, true);
});

test('normal slower historical cadence remains connected', () => {
    const result = compact(rows([1, 1, 1, 1, 1], 30000));
    assert.equal(result.length, 2);
    assert.equal(result[0].runEnd - result[0].runStart, 120000);
    assert.equal(compact(rows([1, 1], 60000)).length, 2);
});

test('a large gap relative to established cadence breaks the line', () => {
    const input = rows([1, 1, 1, 1, 1]);
    input.push({ t: new Date(1700000120000).toISOString(), score: 1 });
    const result = compact(input);
    assert.equal(result.filter(p => p.y === null).length, 1);
    assert.equal(result.at(-1).isolated, true);
});

test('peaks and trigger row references survive compression', () => {
    const input = rows([1, 1, 1, 8, 1, 1]);
    input[1].triggered = true;
    const result = compact(input);
    assert.ok(result.some(p => p.y === 8 && p.changed));
    assert.equal(result.find(p => p.triggered).rowIndex, 1);
    assert.equal(compact([]).length, 0);
});

test('nearby trigger points group without chaining across the whole chart', () => {
    const groups=context.groupTriggerPoints([{x:10,y:20},{x:20,y:22},{x:32,y:20},{x:50,y:20},{x:55,y:80}]);
    assert.deepEqual(Array.from(groups,g=>g.length),[3,1,1]);
    assert.equal(context.groupTriggerPoints([]).length,0);
});

test('time ranges use the latest historical sample and honor custom bounds', () => {
    const rangeContext={document:{getElementById:()=>({value:'30'})},customRange:null};
    vm.createContext(rangeContext);
    vm.runInContext(script.slice(script.indexOf('function visibleRows('),script.indexOf("document.getElementById('rangeSelect').onchange")),rangeContext);
    const input=rows(Array(121).fill(1),60000);
    assert.equal(rangeContext.visibleRows(input).length,31);
    rangeContext.document.getElementById=()=>({value:'all'});
    assert.equal(rangeContext.visibleRows(input).length,121);
    rangeContext.customRange={start:new Date(input[5].t).getTime(),end:new Date(input[8].t).getTime()};
    assert.equal(rangeContext.visibleRows(input).length,4);
});
