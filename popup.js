const $ = id => document.getElementById(id);
let currentTab = null;
let currentJobs = [];
let updateVersion = 0;
const el = (tag, value, className) => { const node=document.createElement(tag); node.textContent=value; if(className) node.className=className; return node; };
function intervalText(seconds) {
  if (seconds % 3600 === 0) return `${seconds / 3600}시간`;
  if (seconds % 60 === 0) return `${seconds / 60}분`;
  return `${seconds}초`;
}
function showStatus(message, error=false) { $('status').textContent=message; $('status').classList.toggle('error', error); }
function remainingText(when) {
  if (!when) return '시간 확인 중';
  const seconds = Math.ceil((when - Date.now()) / 1000);
  if (seconds <= 0) return '곧 새로고침';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return (hours ? `${hours}시간 ` : '') + (minutes ? `${minutes}분 ` : '') + `${rest}초 후`;
}
async function updateCountdowns() {
  const alarms = await chrome.alarms.getAll();
  const times = new Map(alarms.map(alarm => [alarm.name, alarm.scheduledTime]));
  for (const item of document.querySelectorAll('[data-countdown-tab]')) {
    item.textContent = remainingText(times.get('refresh:' + item.dataset.countdownTab));
  }
  const current = currentJobs.find(job => job.tabId === currentTab?.id);
  $('nextRefresh').hidden = !current;
  if (current) $('countdown').textContent = remainingText(times.get('refresh:' + current.tabId));
}
async function send(message) { const response=await chrome.runtime.sendMessage(message); if(!response?.ok) throw new Error(response?.error || '요청을 처리하지 못했습니다.'); }
async function update() {
  const version = ++updateVersion;
  const stored = (await chrome.storage.local.get('jobs')).jobs || [];
  if (version !== updateVersion) return;
  currentJobs=stored;
  const current=currentJobs.find(job => job.tabId === currentTab?.id);
  $('count').textContent=String(currentJobs.length);
  $('stop').hidden=!current;
  $('start').textContent=current ? '간격 변경' : '자동 새로고침 시작';
  if(current) showStatus(`${intervalText(current.seconds)}마다 자동 새로고침 중`);
  else if(currentTab && /^https?:\/\//i.test(currentTab.url || '')) showStatus('이 탭은 자동 새로고침이 꺼져 있어요.');
  const list=$('list');
  const fragment=document.createDocumentFragment();
  if(!currentJobs.length) { $('nextRefresh').hidden=true; list.replaceChildren(el('div','실행 중인 탭이 없어요.','empty')); return; }
  for(const job of currentJobs) {
    const row=el('div','', 'list-item'); const info=el('div','','list-text');
    const tab=await chrome.tabs.get(job.tabId).catch(()=>null);
    info.append(el('div',tab?.title || job.title,'list-title'),el('div',`${intervalText(job.seconds)} 간격${job.tabId === currentTab?.id ? ' · 현재 탭' : ''}`,'list-meta'));
    const next=el('div','시간 확인 중','list-countdown'); next.dataset.countdownTab=String(job.tabId); info.append(next);
    const stop=el('button','중지'); stop.type='button'; stop.setAttribute('aria-label',`${tab?.title || job.title} 새로고침 중지`);
    stop.onclick=async()=>{ stop.disabled=true; try { await send({type:'stop',tabId:job.tabId}); await update(); } catch(e) { showStatus(e.message,true); stop.disabled=false; } };
    row.append(info,stop); fragment.append(row);
  }
  if (version === updateVersion) { list.replaceChildren(fragment); await updateCountdowns(); }
}
async function init() {
  [currentTab]=await chrome.tabs.query({active:true,currentWindow:true});
  const valid=currentTab?.url && /^https?:\/\//i.test(currentTab.url);
  $('tabTitle').textContent=currentTab?.title || '탭을 찾을 수 없어요';
  $('tabHost').textContent=valid ? new URL(currentTab.url).host : '일반 웹사이트 탭에서 사용해 주세요.';
  $('start').disabled=!valid;
  for (const button of document.querySelectorAll('[data-seconds]')) button.addEventListener('click',()=>{
    const seconds=Number(button.dataset.seconds); $('unit').value=seconds % 60 === 0 ? '60' : '1'; $('amount').value=seconds / Number($('unit').value);
  });
  $('start').addEventListener('click',async()=>{
    const amount=Number($('amount').value), seconds=amount*Number($('unit').value);
    if(!$('amount').value || !Number.isInteger(amount) || amount<1 || seconds<30 || seconds>86400) { showStatus('30초부터 24시간까지 정수로 입력해 주세요.',true); return; }
    $('start').disabled=true;
    try { await send({type:'start',tabId:currentTab.id,seconds}); await update(); }
    catch(e) { showStatus(e.message,true); }
    finally { $('start').disabled=false; }
  });
  $('stop').addEventListener('click',async()=>{try{await send({type:'stop',tabId:currentTab.id});await update();}catch(e){showStatus(e.message,true);}});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local' && changes.jobs) update();});
  await update();
  setInterval(() => { updateCountdowns().catch(() => {}); }, 1000);
  const current=currentJobs.find(job=>job.tabId===currentTab?.id);
  if(current) { const unit=current.seconds % 60 === 0 ? 60 : 1; $('unit').value=String(unit); $('amount').value=current.seconds/unit; }
}
init().catch(error=>showStatus(error.message,true));
