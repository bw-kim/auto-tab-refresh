const ALARM_PREFIX = 'refresh:';
let queue = Promise.resolve();
function serial(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}
async function jobs() { return (await chrome.storage.local.get('jobs')).jobs || []; }
async function save(list) { await chrome.storage.local.set({jobs:list}); }
async function setBadge(tabId, enabled) {
  try {
    await chrome.action.setBadgeBackgroundColor({tabId, color:'#438b78'});
    await chrome.action.setBadgeText({tabId, text:enabled ? 'ON' : ''});
  } catch (_) {}
}
async function stop(tabId) {
  await chrome.alarms.clear(ALARM_PREFIX + tabId);
  await save((await jobs()).filter(job => job.tabId !== tabId));
  await setBadge(tabId, false);
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['start','stop'].includes(message.type)) return false;
  serial(async () => {
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error('탭을 찾을 수 없습니다.');
    if (message.type === 'stop') { await stop(tabId); return; }
    const seconds = Number(message.seconds);
    if (!Number.isInteger(seconds) || seconds < 30 || seconds > 86400) throw new Error('30초부터 24시간까지 설정할 수 있습니다.');
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.url || !/^https?:\/\//i.test(tab.url)) throw new Error('일반 웹사이트 탭에서만 사용할 수 있습니다.');
    const job = {tabId, origin:new URL(tab.url).origin, title:tab.title || tab.url, seconds, startedAt:Date.now()};
    const list = (await jobs()).filter(item => item.tabId !== tabId);
    list.push(job);
    await chrome.alarms.clear(ALARM_PREFIX + tabId);
    await chrome.alarms.create(ALARM_PREFIX + tabId, {delayInMinutes:seconds/60, periodInMinutes:seconds/60});
    await save(list);
    await setBadge(tabId, true);
  }).then(() => respond({ok:true}), error => respond({ok:false,error:error.message}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  serial(async () => {
    const tabId = Number(alarm.name.slice(ALARM_PREFIX.length));
    const job = (await jobs()).find(item => item.tabId === tabId);
    if (!job) { await chrome.alarms.clear(alarm.name); return; }
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.url || !/^https?:\/\//i.test(tab.url) || new URL(tab.url).origin !== job.origin) { await stop(tabId); return; }
    try { await chrome.tabs.reload(tabId); }
    catch (error) { await stop(tabId); }
  });
});
chrome.tabs.onRemoved.addListener(tabId => { serial(() => stop(tabId)); });
chrome.runtime.onStartup.addListener(() => {
  serial(async () => {
    for (const alarm of await chrome.alarms.getAll()) if (alarm.name.startsWith(ALARM_PREFIX)) await chrome.alarms.clear(alarm.name);
    await save([]);
  });
});
