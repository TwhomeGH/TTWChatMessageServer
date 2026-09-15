let viewerChart, msgChart, scoreChart;
let cfg = {};
let graphRows = [], selectedTrigger = null;
let allRows = [], customRange = null;
function visibleRows(rows) {
    if(!rows.length)return [];
    const range=document.getElementById('rangeSelect').value;
    const end=customRange?.end??Math.max(...rows.map(r=>new Date(r.t).getTime()).filter(Number.isFinite));
    const start=customRange?.start??(range==='all'?-Infinity:end-Number(range)*60000);
    return rows.filter(r=>{const t=new Date(r.t).getTime();return t>=start&&t<=end;});
}
document.getElementById('rangeSelect').onchange=()=>{customRange=null;document.getElementById('triggerGroup').hidden=true;updateCharts(allRows);};
function groupTriggerPoints(points) {
    const groups=[];
    for(const point of points) {
        const group=groups.at(-1);
        if(group&&point.x-group[0].x<=24&&Math.abs(point.y-group[0].y)<=20)group.push(point);
        else groups.push([point]);
    }
    return groups;
}
function showTriggerGroup(group) {
    const rows=group.map(p=>graphRows[p.rowIndex]);
    const panel=document.getElementById('triggerGroup');panel.replaceChildren();panel.hidden=false;
    const title=document.createElement('p');title.textContent=rows.length+' 次密集觸發 · '+fmtTime(rows[0].t)+'–'+fmtTime(rows.at(-1).t);panel.append(title);
    const zoom=document.createElement('button');zoom.className='bg-purple-700 rounded px-2 py-1 my-2';zoom.textContent='放大此群組';
    zoom.onclick=()=>{const start=new Date(rows[0].t).getTime(),end=new Date(rows.at(-1).t).getTime();const padding=Math.max(1000,(end-start)*.15);customRange={start:start-padding,end:end+padding};updateCharts(allRows);};panel.append(zoom);
    for(const row of rows){const button=document.createElement('button');button.className='block text-left text-purple-200 py-1';button.textContent=fmtTime(row.t)+' · '+triggerHistoryInfo(row).label;button.onclick=()=>selectTrigger(row);panel.append(button);}
}
// Display compression only. Keep graphRows intact for cards, evidence and history.
function compactScoreSeries(rows, readValue, keepTriggers = false) {
    const points = [];
    // Older histories may have a slower evaluation cadence than the current 5 s.
    // Infer cadence only with enough intervals; two distant samples alone cannot
    // tell us whether collection stopped or was simply infrequent.
    const intervals = rows.slice(1).map((row,i)=>new Date(row.t)-new Date(rows[i].t))
        .filter(delta=>Number.isFinite(delta)&&delta>0).sort((a,b)=>a-b);
    const cadence = intervals.length >= 3 ? intervals[Math.floor((intervals.length-1)/2)] : null;
    const gapLimit = cadence === null ? Infinity : Math.max(20000,cadence*4);
    let run = [], previous = null;
    const flush = () => {
        if (!run.length) return;
        for (let i = 0; i < run.length; i++) {
            const point = run[i];
            if (i === 0 || i === run.length - 1 || point.triggered) {
                points.push({ ...point, runStart: run[0].x, runEnd: run.at(-1).x, samples: run.length });
            }
        }
        run = [];
    };
    rows.forEach((row, rowIndex) => {
        const x = new Date(row.t).getTime(), y = readValue(row);
        if (!Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
            flush(); previous = null; return;
        }
        const continuous = previous && x > previous.x && x - previous.x <= gapLimit;
        if (!continuous || previous.y !== y) flush();
        if (!continuous && points.length) points.push({ x, y: null });
        const point = { x, y, rowIndex, triggered: keepTriggers && !!row.triggered,
            changed: !!continuous && previous.y !== y };
        run.push(point); previous = point;
    });
    flush();
    for(let i=0;i<points.length;i++) {
        const p=points[i];
        if(p.y===null)continue;
        const hasPrevious=points[i-1]?.y!=null&&points[i-1].x<p.x;
        const hasNext=points[i+1]?.y!=null&&points[i+1].x>p.x;
        p.isolated=!hasPrevious&&!hasNext;
        p.endpoint=!hasPrevious||!hasNext;
    }
    return points;
}
function scoreDuration(ms) {
    const seconds = Math.max(0, Math.round(ms / 1000));
    return seconds >= 60 ? Math.floor(seconds / 60)+' 分 '+seconds%60+' 秒' : seconds+' 秒';
}
let focusedPlatform = null;
const platformOrder = ['TikTok','Twitch','Kick','Odysee','Youtube','Unknown'];
const platformColors = { TikTok:'#22d3ee', Twitch:'#c084fc', Kick:'#4ade80', Odysee:'#fb923c', Youtube:'#fb7185', Unknown:'#94a3b8' };
const numberText = value => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
function renderPlatformCards() {
    const historical = selectedTrigger !== null;
    const row = historical ? allRows.find(r => r.t === selectedTrigger) : allRows.at(-1);
    const platforms = historical ? row?.evidence?.platforms ?? row?.platforms : row?.platforms;
    const source = historical ? row?.evidence?.sourcePlatform ?? row?.sourcePlatform : row?.sourcePlatform;
    const threshold = historical ? row?.evidence?.threshold : cfg.scoreThreshold ?? 1.8;
    const stale = !historical && row && Date.now() - new Date(row.t).getTime() > 20000;
    document.getElementById('platformContext').textContent = historical
      ? '歷史快照 · '+fmtTime(row?.t)+(Array.isArray(platforms)?'':' · 此紀錄未保存平台數據')
      : '即時評估 · '+(row ? fmtTime(row.t)+(stale?' · 資料已停止更新，以下為最後樣本':'') : '等待評估資料');
    document.getElementById('liveBtn').disabled = !historical && !customRange;
    document.getElementById('platformCards').innerHTML = platformOrder.map(platform => {
      const p = platforms?.find(p => p.platform === platform);
      const winner = p && source === platform;
      const limits = historical ? row?.evidence : cfg;
      const missing = p ? [p.windowMsgs < (limits?.minMessages??6)?'留言不足':'', p.uniqueUsers < (limits?.minUsers??3)?'人數不足':'', p.messageRatio < 1.5?'聊天倍率不足':''].filter(Boolean) : [];
      const status = !p ? historical?'未保存平台數據':'尚無平台樣本' : winner?'本次主導':p.eligible?'平台合格':missing.join('、')||'未達平台門檻';
      return `<button class="platform-card ${winner?'winner':''}" style="--platform-color:${platformColors[platform]}" data-platform="${platform}" aria-pressed="${focusedPlatform===platform}">
        <div class="font-semibold">${sourceLabel(platform)}</div>
        <div class="text-xs text-gray-400">${esc(p?.transports?.map(transportLabel).join('＋') || '管道未記錄')}</div>
        <div class="text-xl font-bold my-1">${numberText(p?.score)} <span class="text-xs text-gray-400">/ ${numberText(threshold)}</span></div>
        <div class="text-xs">${status}</div><div class="text-xs text-gray-400 mt-1">${p ? esc(p.windowMsgs??'—')+' 則 · '+esc(p.uniqueUsers??'—')+' 人':'— 則 · — 人'}</div>
        <div class="text-xs text-gray-400">採計分數 ${numberText(p?.contribution)}</div>
      </button>`;
    }).join('');
}
document.getElementById('platformCards').onclick = e => {
    const button=e.target.closest('[data-platform]'); if(!button)return;
    focusedPlatform=focusedPlatform===button.dataset.platform?null:button.dataset.platform;
    renderPlatformCards(); updatePlatformCurves(); scoreChart.update('none');
};
document.getElementById('liveBtn').onclick = () => selectTrigger(null);
document.querySelectorAll('[data-chart]').forEach(button => button.onclick = () => {
    document.querySelectorAll('[data-chart]').forEach(b => b.setAttribute('aria-pressed', String(b===button)));
    ['score','viewer','msg'].forEach(name => document.getElementById(name+'Pane').hidden=name!==button.dataset.chart);
    ({score:scoreChart,viewer:viewerChart,msg:msgChart})[button.dataset.chart].resize();
});
function updatePlatformCurves() {
    scoreChart.data.datasets.splice(2);
    for(const platform of platformOrder) {
      if(!graphRows.some(row=>row.platforms?.some(p=>p.platform===platform)))continue;
      scoreChart.data.datasets.push({label:sourceLabel(platform),data:compactScoreSeries(graphRows,row=>row.platforms?.find(p=>p.platform===platform)?.score),borderColor:platformColors[platform],borderWidth:focusedPlatform===platform?3:1.5,hidden:focusedPlatform!==null&&focusedPlatform!==platform,pointRadius:context=>context.raw?.endpoint?3:0,spanGaps:false});
    }
}

const chartColors = {
    viewers: 'rgb(96,165,250)',
    viewersBase: 'rgba(96,165,250,0.35)',
    msg: 'rgb(34,211,238)',
    msgBase: 'rgba(34,211,238,0.35)',
    score: 'rgb(192,132,252)',
    threshold: 'rgba(248,113,113,0.7)',
};

function sourceLabel(platform) { return platform === 'Unknown' || platform === 'Userscript' ? '未知來源' : platform; }
function transportLabel(value) { return value === 'userscript' ? 'Userscript' : value === 'api' ? 'API／直連' : '未記錄'; }
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function fmtTime(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('zh-TW', { hour12: false });
}

function triggerColor(row) {
    return row.status==='shadow'?'#fbbf24':row.status==='success'?'#4ade80':row.status==='failed'?'#94a3b8':'#f87171';
}
function selectTrigger(row) {
    selectedTrigger=row?.t??null;
    if(!row) {customRange=null;document.getElementById('triggerGroup').hidden=true;}
    else if(!graphRows.some(r=>r.t===row.t)) {
        document.getElementById('triggerGroup').hidden=true;
        const t=new Date(row.t).getTime();const minutes=Number(document.getElementById('rangeSelect').value)||30;
        customRange={start:t-minutes*30000,end:t+minutes*30000};
    }
    updateCharts(allRows);
}
function triggerHistoryInfo(row) {
    const validCount = value => Number.isInteger(value) && value >= 0;
    const count = [row.evidence?.total, row.windowMsgs].find(validCount);
    const users = [row.evidence?.uniqueUsers, row.uniqueUsers].find(validCount);
    const hasDetails = Array.isArray(row.evidence?.messages);
    const countText = count === undefined ? '留言數未知' : count+' 則';
    return {
        label: countText+(hasDetails ? '' : '（舊紀錄，無留言明細）'),
        summary: countText+(users === undefined ? '' : ' / '+users+' 人'),
        hasDetails,
        explanation: hasDetails ? '點選查看當時留言' :
            '此筆歷史紀錄未保存當時的留言明細，無法補回；'+
            (count === undefined ? '留言數量也未記錄，不能視為 0 則。' : '僅保留 '+count+' 則的統計數量。')
    };
}
function renderTriggerDetail() {
    const select=document.getElementById('triggerSelect'), detail=document.getElementById('triggerDetail');
    const candidates=allRows.filter(r=>r.triggered);
    if (!candidates.some(r=>r.t===selectedTrigger)) selectedTrigger=null;
    select.replaceChildren();
    const liveOption=document.createElement('option');liveOption.value='';liveOption.textContent='即時模式（選擇事件查看快照）';select.append(liveOption);
    for(const row of [...candidates].reverse()) { const option=document.createElement('option');option.value=row.t;option.textContent=fmtTime(row.t)+' · '+(row.mode==='shadow'?'影子':'正式')+' · '+triggerHistoryInfo(row).label;select.append(option); }
    select.value=selectedTrigger||'';
    const row=candidates.find(r=>r.t===selectedTrigger);detail.replaceChildren();
    if(!row){detail.textContent=candidates.length?'目前顯示即時平台分數；點選圖上觸發點或選單查看歷史原因。':'尚無觸發紀錄；平台卡片仍會隨評估更新。';return;}
    const heading=document.createElement('p');heading.className='font-semibold text-purple-200';heading.textContent=fmtTime(row.t)+' · '+row.reason;detail.append(heading);
    const ev=row.evidence;
    const historyInfo=triggerHistoryInfo(row);
    if(!historyInfo.hasDetails){const p=document.createElement('p');p.textContent=historyInfo.explanation;detail.append(p);return;}
    const summary=document.createElement('p');summary.className='text-gray-400 my-2';
    summary.textContent='統計窗口 '+fmtTime(ev.windowStart)+'–'+fmtTime(ev.windowEnd)+' · '+ev.total+' 則 / '+ev.uniqueUsers+' 位 · 最少 '+ev.minMessages+' 則 / '+ev.minUsers+' 位 · 分數 '+Number(row.score).toFixed(2)+' / 門檻 '+ev.threshold+' · 每人最多計入 '+ev.maxPerUser+' 則'+(ev.truncated?' · 僅保留最後 200 則':'');detail.append(summary);
    const contribution=document.createElement('div');contribution.className='my-3 space-y-1 text-gray-300';
    for(const p of ev.platforms||[]){const line=document.createElement('p');line.textContent=sourceLabel(p.platform)+' · '+((p.transports||[]).map(transportLabel).join('＋')||'管道未記錄')+' · '+p.windowMsgs+' 則 / '+p.uniqueUsers+' 位 · '+Number(p.msgRate).toFixed(1)+'/min，基準 '+Number(p.baseMsgRate).toFixed(1)+' · 平台分數 '+Number(p.score).toFixed(2)+' · '+(p.platform===ev.sourcePlatform?'觸發來源，採計 '+Number(p.contribution).toFixed(2):p.eligible?'合格，未高於來源平台':'未達最低反應門檻');contribution.append(line);}detail.append(contribution);
    const list=document.createElement('div');list.className='max-h-72 overflow-y-auto space-y-2';
    for(const m of ev.messages||[]){const item=document.createElement('div');item.className='bg-gray-900 rounded-lg p-3';const meta=document.createElement('p');meta.className='text-xs text-gray-400';meta.textContent=fmtTime(m.t)+' · '+m.name+' · '+sourceLabel(m.platform)+' / '+transportLabel(m.transport)+' · '+(m.timeSource==='platform'?'平台時間':'接收時間')+(m.originalTime&&m.originalTime!==m.t?'（校準前 '+fmtTime(m.originalTime)+'）':'');const content=document.createElement('p');content.className='whitespace-pre-wrap break-words mt-1';content.textContent=m.message;item.append(meta,content);list.append(item);}detail.append(list);
}
const triggerLabels={id:'triggerLabels',beforeDatasetsDraw(chart){
    const data=chart.data.datasets[0].data,meta=chart.getDatasetMeta(0);
    const events=data.flatMap((p,index)=>p.triggered&&meta.data[index]?[{x:meta.data[index].x,y:meta.data[index].y,index,rowIndex:p.rowIndex}]:[]);
    chart.$triggerGroups=groupTriggerPoints(events).filter(group=>group.length>1&&!group.some(p=>graphRows[p.rowIndex]?.t===selectedTrigger));
    const grouped=new Set(chart.$triggerGroups.flatMap(group=>group.map(p=>p.index)));
    meta.data.forEach((point,i)=>{const p=data[i];point.options={...point.options,radius:grouped.has(i)?0:p.triggered?6:p.endpoint?3.5:p.changed?2.5:0};});
    const row=graphRows.find(r=>r.t===selectedTrigger), ev=row?.evidence;
    if(!ev?.windowStart || !ev?.windowEnd)return;
    const left=Math.max(chart.chartArea.left,chart.scales.x.getPixelForValue(ev.windowStart)),right=Math.min(chart.chartArea.right,chart.scales.x.getPixelForValue(ev.windowEnd));
    if(right<left)return;
    const ctx=chart.ctx;ctx.save();ctx.fillStyle='rgba(192,132,252,0.12)';ctx.fillRect(left,chart.chartArea.top,Math.max(2,right-left),chart.chartArea.bottom-chart.chartArea.top);ctx.restore();
},afterDatasetsDraw(chart){
    const ctx=chart.ctx, area=chart.chartArea, meta=chart.getDatasetMeta(0);const occupied=[];
    const plotted=chart.data.datasets[0].data;
    const allIndices=plotted.map((p,i)=>p.triggered?i:-1).filter(i=>i>=0);
    const selectedIndex=plotted.findIndex(p=>p.triggered&&graphRows[p.rowIndex]?.t===selectedTrigger);
    const grouped=new Set((chart.$triggerGroups||[]).flatMap(group=>group.map(p=>p.index)));
    const indices=[selectedIndex>=0?selectedIndex:allIndices.at(-1)].filter(i=>i>=0&&!grouped.has(i));
    ctx.save();ctx.font='11px sans-serif';
    chart.$groupBoxes=[];
    for(const group of chart.$triggerGroups||[]) {
        const width=ctx.measureText(group.length+' 次觸發').width+16,height=26;
        const x=Math.max(area.left,Math.min(group[0].x-width/2,area.right-width)),y=Math.max(area.top,Math.min(group[0].y-height/2,area.bottom-height));
        const box={x,y,width,height,group};chart.$groupBoxes.push(box);occupied.push(box);
        ctx.fillStyle='#334155';ctx.fillRect(x,y,width,height);ctx.strokeStyle='#c4b5fd';ctx.strokeRect(x,y,width,height);ctx.fillStyle='#fff';ctx.fillText(group.length+' 次觸發',x+8,y+18);
    }
    const overlaps=(a,b,gap=5)=>a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;
    const dots=allIndices.map(i=>meta.data[i]).filter(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)).map(p=>({x:p.x-7,y:p.y-7,width:14,height:14}));
    ctx.beginPath();ctx.rect(area.left,area.top,area.right-area.left,area.bottom-area.top);ctx.clip();
    for(const i of indices){const row=graphRows[plotted[i].rowIndex],point=meta.data[i];if(!point)continue;
        const info=triggerHistoryInfo(row);
        const preview=row.evidence?.messages?.[0]?.message;
        let text=info.hasDetails?(row.evidence?.sourcePlatform?sourceLabel(row.evidence.sourcePlatform)+' · ':'')+info.summary+(preview?' · '+preview.slice(0,12):''):'舊紀錄 · 無明細';
        const maxWidth=Math.min(240,(area.right-area.left)*0.55);
        if(maxWidth<70)continue;
        if(ctx.measureText(text).width+16>maxWidth){while(text.length&&ctx.measureText(text+'…').width+16>maxWidth)text=text.slice(0,-1);text+='…';}
        const width=ctx.measureText(text).width+16,height=24;
        const candidates=[];
        for(const dy of [0,-32,32,-64,64])for(const side of ['right','left'])candidates.push({x:side==='right'?point.x+16:point.x-16-width,y:point.y-height/2+dy,width,height,side});
        const box=candidates.find(b=>b.x>=area.left+2&&b.x+b.width<=area.right-2&&b.y>=area.top+2&&b.y+b.height<=area.bottom-2&&!occupied.some(o=>overlaps(b,o))&&!dots.some(d=>overlaps(b,d,2)));
        if(!box)continue;
        occupied.push(box);
        const {x,y,side}=box;
        ctx.strokeStyle=triggerColor(row);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(point.x+(side==='right'?8:-8),point.y);ctx.lineTo(side==='right'?x:x+width,y+height/2);ctx.stroke();
        ctx.fillStyle='#172235';ctx.fillRect(x,y,width,height);ctx.lineWidth=i===selectedIndex?2:1;ctx.strokeRect(x,y,width,height);ctx.fillStyle='#e2e8f0';ctx.fillText(text,x+8,y+16);
    }ctx.restore();
}};
document.getElementById('triggerSelect').onchange=e=>selectTrigger(allRows.find(r=>r.t===e.target.value));

function buildCharts() {
    // Hit-test line segments as ranges, rather than making every sample a hover target.
    Chart.Interaction.modes.scoreRange = (chart, event) => {
        chart.$scoreEventHit = false;
        let best = null, distance = 16;
        chart.data.datasets.forEach((dataset, datasetIndex) => {
            if (datasetIndex === 1 || !chart.isDatasetVisible(datasetIndex)) return;
            const elements = chart.getDatasetMeta(datasetIndex).data;
            dataset.data.forEach((point, index) => {
                if (point.y === null) return;
                const el = elements[index]; if (!el) return;
                if (point.triggered && Math.hypot(event.x-el.x,event.y-el.y) <= 10) {
                    best = {element:el,datasetIndex,index}; distance = -1; chart.$scoreEventHit = true; return;
                }
                const next=dataset.data[index+1], end=elements[index+1];
                let d=Infinity;
                if(next && next.y !== null && end && event.x >= el.x && event.x <= end.x && end.x > el.x) {
                    const y=el.y+(end.y-el.y)*(event.x-el.x)/(end.x-el.x);
                    d=Math.abs(event.y-y);
                } else if(Math.abs(event.x-el.x)<=6) d=Math.hypot(event.x-el.x,event.y-el.y);
                if(d<distance){distance=d;best={element:el,datasetIndex,index};}
            });
        });
        return best ? [best] : [];
    };
    const common = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { labels: { color: '#cbd5e1' } } },
        scales: {
            x: { ticks: { color: '#94a3b8', maxTicksLimit: 12 }, grid: { color: 'rgba(148,163,184,0.1)' } },
            y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,0.1)' } },
        },
    };
    viewerChart = new Chart(document.getElementById('viewerChart'), {
        type: 'line',
        data: { labels: [], datasets: [
            { label: '觀眾數', data: [], borderColor: chartColors.viewers, backgroundColor: chartColors.viewers, borderWidth: 2, tension: 0.3, pointRadius: 0 },
            { label: '基準觀眾', data: [], borderColor: chartColors.viewersBase, backgroundColor: chartColors.viewersBase, borderWidth: 1.5, borderDash: [5,5], tension: 0.3, pointRadius: 0 },
        ]},
        options: { ...common, plugins: { legend: { labels: { color: '#cbd5e1' } } } },
    });
    msgChart = new Chart(document.getElementById('msgChart'), {
        type: 'line',
        data: { labels: [], datasets: [
            { label: '訊息/min', data: [], borderColor: chartColors.msg, backgroundColor: chartColors.msg, borderWidth: 2, tension: 0.3, pointRadius: 0 },
            { label: '基準訊息', data: [], borderColor: chartColors.msgBase, backgroundColor: chartColors.msgBase, borderWidth: 1.5, borderDash: [5,5], tension: 0.3, pointRadius: 0 },
        ]},
        options: { ...common, plugins: { legend: { labels: { color: '#cbd5e1' } } } },
    });
    scoreChart = new Chart(document.getElementById('scoreChart'), {
        type: 'line',
        data: { labels: [], datasets: [
            {
                label: '分數', data: [], borderColor: chartColors.score, backgroundColor: chartColors.score,
                borderWidth: 2, tension: 0, spanGaps:false,
                pointBackgroundColor: context => context.raw?.triggered ? triggerColor(graphRows[context.raw.rowIndex]) : chartColors.score,
                pointRadius: context => context.raw?.triggered ? 6 : context.raw?.endpoint ? 3.5 : context.raw?.changed ? 2.5 : 0,
                pointHoverRadius: 5,
            },
            { label: '門檻', data: [], borderColor: chartColors.threshold, backgroundColor: chartColors.threshold, borderWidth: 1.5, borderDash: [6,4], pointRadius: 0 },
        ]},
        plugins:[triggerLabels],
        options: { ...common, interaction:{mode:'scoreRange',intersect:false}, scales: { ...common.scales, x:{...common.scales.x,type:'linear',ticks:{...common.scales.x.ticks,callback:value=>fmtTime(value)}}, y: { ...common.scales.y, grace:'12%' } }, onClick: (event, elements) => {
            const group=(scoreChart.$groupBoxes||[]).find(b=>event.x>=b.x&&event.x<=b.x+b.width&&event.y>=b.y&&event.y<=b.y+b.height);
            if(group){showTriggerGroup(group.group);return;}
            const point=elements.find(e=>e.datasetIndex===0&&scoreChart.data.datasets[0].data[e.index]?.triggered);
            if(point && scoreChart.$scoreEventHit)selectTrigger(graphRows[scoreChart.data.datasets[0].data[point.index].rowIndex]);
        }, plugins: { legend: { labels: { color: '#cbd5e1' } }, tooltip: { callbacks: {
          title: items => { const p=items[0]?.raw;return p ? fmtTime(p.runStart)+'–'+fmtTime(p.runEnd) : ''; },
          label: item => item.dataset.label+'：'+numberText(item.raw.y),
          afterBody: items => {
            const p=items[0]?.raw, row=graphRows[p?.rowIndex];
            const range=p ? ['同分數持續 '+scoreDuration(p.runEnd-p.runStart)+' · '+p.samples+' 筆評估（明細仍逐筆保留）'] : [];
            if(items[0]?.datasetIndex!==0 || !row?.triggered || !scoreChart.$scoreEventHit)return range;
            const info=triggerHistoryInfo(row);
            return [...range,'觸發時間 '+fmtTime(row.t),row.reason,info.label,...(info.hasDetails?row.evidence.messages:[]).slice(0,3).map(m=>m.name+': '+m.message.slice(0,40)),info.explanation];
        } } } } },
    });
}

function updateCharts(stats) {
    allRows=stats;
    stats=visibleRows(stats);
    graphRows = stats;
    document.getElementById('rangeContext').textContent=stats.length?(customRange?'自訂範圍 · ':'依最後樣本 · ')+fmtTime(stats[0].t)+'–'+fmtTime(stats.at(-1).t):'此範圍沒有評估資料';
    renderTriggerDetail();
    renderPlatformCards();
    const labels = stats.map(s => fmtTime(s.t));
    const th = cfg.scoreThreshold ?? 1.8;

    viewerChart.data.labels = labels;
    viewerChart.data.datasets[0].data = stats.map(s => s.viewers);
    viewerChart.data.datasets[1].data = stats.map(s => s.baseViewers ?? 0);
    viewerChart.update('none');

    msgChart.data.labels = labels;
    msgChart.data.datasets[0].data = stats.map(s => s.msgRate ?? 0);
    msgChart.data.datasets[1].data = stats.map(s => s.baseMsgRate ?? 0);
    msgChart.update('none');

    scoreChart.data.labels = labels;
    // Linear scales otherwise expand to rounded epoch ticks, creating apparent
    // empty time before the first sample. Bound the view to recorded timestamps.
    const times=stats.map(row=>new Date(row.t).getTime()).filter(Number.isFinite);
    if(times.length) {
        const first=Math.min(...times),last=Math.max(...times);
        scoreChart.options.scales.x.min=first===last?first-5000:first;
        scoreChart.options.scales.x.max=first===last?last+5000:last;
    } else {
        delete scoreChart.options.scales.x.min;
        delete scoreChart.options.scales.x.max;
    }
    scoreChart.data.datasets[0].data = compactScoreSeries(stats,row=>row.score,true);
    scoreChart.data.datasets[1].data = compactScoreSeries(stats,row=>row.evidence?.threshold ?? th);
    updatePlatformCurves();
    scoreChart.update('none');
}

function renderCards(stats) {
    const last = stats[stats.length - 1];
    const container = document.getElementById('statusCards');
    if (!last) {
        container.innerHTML = '<div class="col-span-full text-center text-gray-500 py-4">尚無評估資料（自動剪輯啟用後每 5 秒產生一筆）</div>';
        return;
    }
    const clips = stats.filter(s => s.triggered).length;
    const cards = [
        { label: '目前觀眾', value: last.viewers, sub: `基準 ${last.baseViewers ?? 0}` },
        { label: '訊息速率', value: `${last.msgRate ?? 0}/min`, sub: `基準 ${last.baseMsgRate ?? 0}` },
        { label: '觸發分數', value: last.score ?? 0, sub: `門檻 ${cfg.scoreThreshold ?? 1.8}`, hot: (last.score ?? 0) >= (cfg.scoreThreshold ?? 1.8) },
        { label: '影子觸發', value: last.shadowTriggers ?? 0, sub: '未建立剪輯' },
        { label: '成功 / 失敗 / 建立中', value: `${last.totalClips ?? 0} / ${last.failedClips ?? 0} / ${last.pending ? 1 : 0}`, sub: `${last.totalTriggers ?? clips} 次觸發` },
        { label: '目前狀態', value: '', sub: esc(last.reason || '') },
    ];
    container.innerHTML = cards.map(c => `
        <div class="bg-gray-800 rounded-2xl shadow-lg p-3 sm:p-4">
            <div class="text-xs text-gray-400 mb-1">${c.label}</div>
            <div class="text-xl sm:text-2xl font-bold ${c.hot ? 'text-red-400' : 'text-gray-100'}">${esc(c.value ?? '')}</div>
            <div class="text-xs text-gray-500 mt-1 truncate" title="${c.sub}">${c.sub || '&nbsp;'}</div>
        </div>
    `).join('');
}

function renderConfig() {
    document.getElementById('configInfo').textContent =
        '模式：'+(cfg.mode==='live'?'正式剪輯':'影子模式（不剪輯）')+' · 熱度：全平台 · 剪輯：Twitch'+' · 窗口 '+(cfg.rateWindowMin??0.5)+' 分 · 最少 '+(cfg.minUsers??3)+' 位發言人 / '+(cfg.minMessages??6)+' 筆 · 確認 '+Math.round((cfg.sustainMin??0.167)*60)+' 秒';
    document.getElementById('cfgBaseline').textContent = cfg.baselineWindowMin ?? 30;
}

async function load() {
    try {
        const res = await fetch('/autoclip/data');
        const result = await res.json();
        if (!result.success) throw new Error(result.error || 'unknown');
        const stats = result.stats || [];
        cfg = result.config || {};
        renderConfig();
        renderCards(stats);
        let timing = document.getElementById('timingRecords');
        if (!timing) { timing = document.createElement('section'); timing.id='timingRecords'; timing.className='bg-gray-800 rounded-2xl p-4 my-4'; document.getElementById('configInfo').parentElement.after(timing); }
        timing.replaceChildren();
        const heading=document.createElement('h2');heading.textContent='最近觸發時間與結果';timing.append(heading);
        for (const row of stats.filter(s=>s.triggered).slice(-20).reverse()) {
            const p=document.createElement('p');p.className='text-sm text-gray-300 my-2';
            const format=t=>t?new Date(t).toLocaleTimeString('zh-TW',{hour12:false}):'—';
            const coverage=row.clip?.timing?.verified?(row.clip.timing.coversPeak?'涵蓋熱度峰值':'未涵蓋熱度峰值'):'尚未核對片段時間';
            p.textContent='開始 '+format(row.heatStartedAt)+' · 峰值 '+format(row.peakAt)+' · 觸發 '+format(row.triggeredAt)+' · 請求 '+format(row.requestedAt)+' · 完成 '+format(row.completedAt)+' · '+({shadow:'影子紀錄',pending:'建立中',success:'成功',failed:'失敗'}[row.status]||row.status||'歷史紀錄')+' · '+coverage+(row.error?' · '+row.error:'');
            timing.append(p);
        }
        if (!viewerChart) buildCharts();
        updateCharts(stats);
    } catch (err) {
        document.getElementById('platformContext').textContent = '更新失敗，平台卡片保留上次資料；請重新整理';
        document.getElementById('statusCards').innerHTML =
            `<div class="col-span-full text-red-400">載入失敗: ${esc(err.message)}</div>`;
    }
}

document.getElementById('refreshBtn').addEventListener('click', load);

document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!confirm('確定要清空自動剪輯分析歷史嗎？')) return;
    const btn = document.getElementById('clearBtn');
    btn.disabled = true;
    btn.textContent = '清空中...';
    try {
        const res = await fetch('/autoclip/clear', { method: 'POST' });
        const result = await res.json();
        if (result.success) {
            btn.textContent = '✅ 已清空';
            load();
        } else {
            btn.textContent = '❌ 失敗';
            alert('清空失敗: ' + (result.error || '未知錯誤'));
        }
    } catch (err) {
        btn.textContent = '❌ 失敗';
        alert('清空失敗: ' + err.message);
    }
    setTimeout(() => { btn.disabled = false; btn.textContent = '🗑️ 清空歷史'; }, 1500);
});

buildCharts();
load();
setInterval(load, 5000); // 每 5 秒更新
