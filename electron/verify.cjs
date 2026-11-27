'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, screen, session, shell } = require('electron');
const assert = require('node:assert/strict');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const act = (window, source) => window.webContents.executeJavaScript(source);

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 180; attempt++) {
    if (await check()) return;
    await pause(125);
  }
  throw new Error(message);
}

async function verifyPortal(widget) {
  const partition = session.fromPartition('persist:homework-clock-chaoxing');
  const origin = 'https://mooc1-api.chaoxing.com';
  partition.protocol.handle('https', async request => {
    const url = new URL(request.url);
    assert.equal(url.origin, origin);
    let page;
    if (url.pathname === '/qa/mobile-entry') {
      return Response.redirect(origin + '/mooc-ans/work/phone/task-work?taskrefId=123&vx=0');
    } else if (url.pathname === '/mooc-ans/work/phone/task-work') {
      assert.equal(url.searchParams.get('vx'), '0');
      page = '<input id="vx" type="hidden" value="0"><button id="continue" onclick="jump()">继续答题</button>' +
        '<script>var vx=document.getElementById("vx").value; function jump(){ processOpenUrl("/qa/homework"); } ' +
        'function processOpenUrl(url){ if(vx == 1){ window.location.href=url; } else { /* mobile bridge */ } }</script>';
    } else if (url.pathname === '/qa/start') {
      page = '<input id="vx" type="hidden" value="0"><button id="same" onclick="location.href=&#39;/qa/next&#39;">进入作业</button>';
    } else if (url.pathname === '/qa/next') {
      page = '<input id="draft" value="未提交的测试草稿">' +
        '<button id="popup" onclick="const w=window.open();if(w)w.location.href=&#39;/qa/popup&#39;">查看资料</button>' +
        '<form action="/qa/post" method="post" target="_blank"><input name="answer" value="example"><button id="form">试交</button></form>' +
        '<button id="blocked" onclick="window.open(&#39;https://example.org/&#39;)">外部页</button>';
    } else if (url.pathname === '/qa/post') {
      page = '<output>' + request.method + ' ' + await request.text() + '</output>';
    } else {
      page = '<h1>作业资料</h1>';
    }
    return new Response('<!doctype html><meta charset="utf-8">' + page, { headers: { 'content-type': 'text/html' } });
  });
  const find = pathname => BrowserWindow.getAllWindows().find(win => win !== widget && win.webContents.getURL() === origin + pathname);
  await act(widget, 'window.clock.open(' + JSON.stringify(origin + '/qa/mobile-entry') + ')');
  await waitFor(() => BrowserWindow.getAllWindows().some(win => win !== widget && win.webContents.getURL().includes('task-work?') && win.webContents.getURL().includes('vx=0')), '手机作业入口未完成跳转');
  const task = BrowserWindow.getAllWindows().find(win => win !== widget && win.webContents.getURL().includes('task-work?'));
  await waitFor(() => act(task, 'window.vx === "1" && document.querySelector("#vx").value === "1"'), '加载后的作业页未启用网页模式');
  await act(task, 'document.querySelector("#continue").click()');
  await waitFor(() => !!find('/qa/homework'), '继续答题未进入网页');
  await act(widget, 'window.clock.open(' + JSON.stringify(origin + '/qa/start') + ')');
  await waitFor(async () => !!find('/qa/start') && await act(find('/qa/start'), '!!document.querySelector("#same")'), '作业页未打开');
  const portal = find('/qa/start');
  await act(portal, 'document.querySelector("#same").click()');
  await waitFor(async () => !!find('/qa/next') && await act(portal, '!!document.querySelector("#popup")'), '同页按钮未导航');
  await act(portal, 'document.querySelector("#popup").click()');
  await waitFor(async () => !!find('/qa/popup') && await act(find('/qa/popup'), 'document.body.innerText.includes("作业资料")'), '按钮未能打开学习通子页');
  assert.equal(await act(portal, 'document.querySelector("#draft").value'), '未提交的测试草稿');
  const popup = find('/qa/popup');
  const preferences = popup.webContents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(popup.webContents.session, partition);
  await act(portal, 'document.querySelector("#form").click()');
  await waitFor(async () => !!find('/qa/post') && await act(find('/qa/post'), '!!document.querySelector("output")'), '跨页表单未打开');
  assert.equal(await act(find('/qa/post'), 'document.querySelector("output").textContent'), 'POST answer=example');
  const count = BrowserWindow.getAllWindows().length;
  await act(portal, 'document.querySelector("#blocked").click()');
  await pause(120);
  assert.equal(BrowserWindow.getAllWindows().length, count);
  await act(widget, 'window.clock.logout()');
  assert.deepEqual(BrowserWindow.getAllWindows().map(win => win.id), [widget.id]);
  console.log('Portal QA passed: same-page navigation, blank popup, POST form, preserved draft, session and logout.');
}

async function verify(window, directory) {
  await fs.mkdir(directory, { recursive: true });
  const screenshot = async name => {
    await pause(230);
    const image = await window.capturePage();
    await fs.writeFile(path.join(directory, name + '.png'), image.toPNG());
  };

  const click = (label) => act(window, 'document.querySelector(' +
    JSON.stringify('button[aria-label="' + label + '"]') + ').click()');
  const chooseSchool = name => act(window, `Array.from(document.querySelectorAll('.school-result')).find(node => node.querySelector('strong').textContent === ${JSON.stringify(name)}).click()`);
  const searchSchools = keyword => act(window, `(() => {
    const field = document.querySelector('input[aria-label="搜索学校"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(keyword)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(() => act(window, 'document.querySelector(\'button[aria-label="新建日程"]\')?.disabled === false'), '组件加载失败');

  if (process.env.HOMEWORK_CLOCK_QA_COUNTDOWNS) {
    const layoutSizes = require('./countdown-sizes.json');
    const fixtures = path.join(directory, 'countdown-positions.json');
    const profile = app.getPath('userData');
    const card = id => BrowserWindow.getAllWindows().find(win => win !== window
      && new URLSearchParams(win.webContents.getURL().split('?')[1]).get('countdown') === id);
    const setup = () => act(window, 'window.clock.setup()');
    const editorButton = selector => act(window, `(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      const { x, y, width, height } = button.getBoundingClientRect();
      const center = { x: Math.round(x + width / 2), y: Math.round(y + height / 2) };
      return { ...center, reachable: button.contains(document.elementFromPoint(center.x, center.y)) };
    })()`);
    const clickEditorButton = async selector => {
      const { x, y, reachable } = await editorButton(selector);
      assert.ok(reachable, `${selector} 按钮被裁切或遮挡`);
      const input = { x, y, button: 'left', clickCount: 1 };
      window.webContents.sendInputEvent({ ...input, type: 'mouseDown' });
      window.webContents.sendInputEvent({ ...input, type: 'mouseUp' });
    };
    const openList = async () => {
      await click('组件设置');
      await act(window, 'document.querySelector(".countdowns-entry").click()');
    };
    const move = (win, bounds) => {
      win.emit('will-move', {}, bounds);
      win.setBounds(bounds);
      win.emit('query-session-end', {});
    };

    if (process.env.HOMEWORK_CLOCK_QA_COUNTDOWNS === 'restore') {
      const expected = JSON.parse(await fs.readFile(fixtures, 'utf8'));
      assert.deepEqual(window.getBounds(), expected.window);
      const { countdowns } = await setup();
      assert.deepEqual(countdowns.map(item => [item.id, item.title, item.visible]), [
        [expected.first.id, '期末答辩', true], [expected.second.id, '提交材料', false]
      ]);
      assert.deepEqual(countdowns.map(item => [item.theme, item.ink]), [['liquid', 'dark'], ['midnight', 'light']]);
      assert.deepEqual(countdowns.map(item => item.layout), ['dial', 'standard']);
      await waitFor(() => card(expected.first.id)?.isVisible(), '已显示的倒计时未重新打开');
      assert.deepEqual(card(expected.first.id).getBounds(), expected.first.bounds);
      assert.equal(card(expected.second.id), undefined);
      await openList();
      await click('显示倒计时：提交材料');
      await waitFor(() => card(expected.second.id)?.isVisible(), '隐藏的倒计时无法重新显示');
      assert.deepEqual(card(expected.second.id).getBounds(), expected.second.bounds);
      await click('编辑倒计时：提交材料');
      await clickEditorButton('.schedule-delete');
      await waitFor(() => act(window, 'document.querySelector(".schedule-delete")?.textContent === "确认删除"'), '点击后未出现删除确认');
      await clickEditorButton('.schedule-delete');
      await waitFor(async () => !(await setup()).countdowns.some(item => item.id === expected.second.id), '未删除倒计时');
      assert.equal(card(expected.second.id), undefined);
      console.log('Countdown restoration QA passed: main and both card positions, visibility, and deletion across two Windows launches.');
      return;
    }

    await act(window, 'window.clock.change("autoSnap", false)');
    window.setBounds({ ...window.getBounds(), width: 320, height: 320 });
    await waitFor(() => act(window, 'innerHeight === 320'), '未应用最小窗口尺寸');
    await openList();
    await click('新建倒计时');
    await act(window, `(() => {
      const form = document.querySelector('.schedule-editor');
      form.elements.title.value = '期末考试';
      form.requestSubmit();
    })()`);
    await waitFor(async () => (await setup()).countdowns.length === 1, '表单未创建倒计时');
    const [first] = (await setup()).countdowns;
    await waitFor(() => card(first.id)?.isVisible(), '新增倒计时未打开桌面卡片');
    assert.equal(await act(card(first.id), 'typeof window.clock'), 'undefined');
    const clock = () => act(card(first.id), 'document.querySelector(".countdown-remaining")?.textContent');
    await waitFor(clock, '卡片未渲染倒计时');
    const clockBefore = await clock();
    await waitFor(async () => (await clock()) !== clockBefore, '倒计时没有逐秒更新');
    assert.equal(first.theme, 'desktop');
    const initialBounds = card(first.id).getBounds();
    const snapshot = async name => {
      await pause(240);
      const image = await card(first.id).capturePage();
      await fs.writeFile(path.join(directory, name + '.png'), image.toPNG());
    };
    await snapshot('countdown-desktop');
    await act(card(first.id), 'document.querySelector(\'button[aria-label="编辑倒计时"]\').click()');
    await waitFor(() => act(window, 'document.querySelector(".schedule-editor input[name=title]")?.value === "期末考试"'), '卡片编辑入口未打开');
    await click('选择颜色 #8ad4b0');
    await waitFor(() => act(window, 'document.querySelector(\'input[name="color"]\').value === "#8ad4b0"'), '未选中倒计时强调色');
    const appearance = name => act(window, `[...document.querySelectorAll('.schedule-editor button')].find(button => button.textContent.trim() === '${name}').click()`);
    await appearance('液态玻璃');
    await appearance('深墨');
    await appearance('圆形');
    await waitFor(() => act(window, '!!document.querySelector(\'.countdown-style-preview [data-theme="liquid"][data-ink="dark"][data-layout="dial"]\')'), '布局和材质预览未跟随选项更新');
    await act(window, `(() => {
      const form = document.querySelector('.schedule-editor');
      form.elements.title.value = '期末答辩';
      document.querySelector('.countdown-style-preview').open = true;
    })()`);
    const editActions = ['.schedule-actions [type="submit"]', '.schedule-delete'];
    assert.deepEqual(await Promise.all(editActions.map(async selector => (await editorButton(selector)).reachable)), [true, true],
      '展开主题预览后，保存和删除仍须能在最小窗口中点击');
    await clickEditorButton(editActions[0]);
    await waitFor(() => act(card(first.id), 'document.querySelector(".countdown-card h1")?.textContent === "期末答辩"'), '卡片未同步编辑结果');
    assert.equal(await act(card(first.id), 'document.querySelector(".countdown-card").style.getPropertyValue("--countdown-accent")'), '#8ad4b0');
    assert.equal(await act(card(first.id), 'document.querySelector(".countdown-card").dataset.ink'), 'dark');
    assert.equal(await act(card(first.id), 'document.querySelector(".countdown-card").dataset.layout'), 'dial');
    assert.deepEqual(card(first.id).getBounds(), { ...initialBounds, ...layoutSizes.dial });
    const { desktopCapturer } = require('electron');
    const getSources = desktopCapturer.getSources;
    let captures = 0;
    desktopCapturer.getSources = (...args) => { captures++; return getSources.apply(desktopCapturer, args); };
    try {
      async function customize(changes) {
        const item = (await setup()).countdowns.find(item => item.id === first.id);
        const updated = { ...item, ...changes };
        await act(window, 'window.clock.saveCountdown(' + JSON.stringify(updated) + ')');
        await waitFor(() => act(card(first.id), `(() => {
          const card = document.querySelector('.countdown-card');
          return card.dataset.theme === '${updated.theme}' && card.dataset.layout === '${updated.layout}'
            && card.querySelector('time').dateTime === '${new Date(updated.at).toISOString()}';
        })()`), '未应用倒计时外观');
        assert.deepEqual(card(first.id).getBounds(), { ...initialBounds, ...layoutSizes[updated.layout] });
      }
      await snapshot('countdown-liquid');
      await customize({ theme: 'paper', layout: 'tiles' });
      await snapshot('countdown-paper');
      await customize({ theme: 'midnight', layout: 'days' });
      await snapshot('countdown-midnight');
      assert.equal(captures, 0, '静态主题不应取样桌面');
      await customize({ theme: 'frost' });
      if ((await setup()).blurSupported) {
        await waitFor(() => captures > 0, '经典磨砂应尝试读取桌面静帧');
      }
      await snapshot('countdown-frost');
      const frostCaptures = captures;
      await customize({ theme: 'liquid', layout: 'dial' });
      await pause(360);
      assert.equal(captures, frostCaptures, '液态玻璃不应继续取样');
      assert.equal(await act(card(first.id), '!!document.querySelector(".countdown-frost-wallpaper")'), false);
      for (const layout of ['standard', 'tiles', 'dial', 'days']) {
        await customize({ theme: 'midnight', layout, at: Date.now() + (layout === 'dial' ? 9 : 129) * 3600000 });
        assert.ok(await act(card(first.id), `[...document.querySelectorAll('.countdown-card-header button')].every(button => {
          const { x, y, width, height } = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(x + width / 2, y + height / 2));
        })`), '变换形状后卡片按钮被遮挡：' + layout);
        if (layout === 'dial') {
          assert.equal(await act(card(first.id), 'getComputedStyle(document.querySelector(".countdown-card")).borderRadius'), '50%');
        }
        await snapshot('layout-' + layout);
        await customize({ layout, at: Date.UTC(9999, 11, 31, 8) });
        assert.ok(await act(card(first.id), 'document.querySelector(".countdown-remaining").scrollWidth <= document.querySelector(".countdown-remaining").clientWidth'), '长天数裁切：' + layout);
        await customize({ layout, at: 0 });
        assert.match(await clock(), /已到时间/, '到期后仍显示倒计时：' + layout);
      }
      await customize({ layout: 'days', at: Date.now() + 9 * 3600000 });
      assert.equal(await act(card(first.id), 'document.querySelector(".cd-hero small").textContent'), '小时');
      await customize({ theme: 'liquid', layout: 'dial', at: first.at });
    } finally { desktopCapturer.getSources = getSources; }

    const added = await act(window, 'window.clock.saveCountdown({ title: "提交材料", at: 0, color: "#f5c278" })');
    const second = added.items.at(-1);
    await waitFor(() => card(second.id)?.isVisible(), '第二个倒计时未打开');
    await waitFor(() => act(card(second.id), 'document.querySelector(".countdown-finished")?.textContent === "已到时间"'), '已到期倒计时未正确显示');
    const { workArea } = screen.getPrimaryDisplay();
    move(window, { ...window.getBounds(), x: workArea.x + 47, y: workArea.y + 68 });
    move(card(first.id), { ...card(first.id).getBounds(), x: workArea.x + 401, y: workArea.y + 87 });
    move(card(second.id), { ...card(second.id).getBounds(), x: workArea.x + 414, y: workArea.y + 251 });
    const expected = {
      window: window.getBounds(), first: { id: first.id, bounds: card(first.id).getBounds() },
      second: { id: second.id, bounds: card(second.id).getBounds() }
    };
    const saved = JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8'));
    assert.deepEqual([saved.x, saved.y], [expected.window.x, expected.window.y]);
    await act(card(second.id), 'document.querySelector(\'button[aria-label="隐藏倒计时"]\').click()');
    await waitFor(() => !card(second.id), '倒计时未隐藏');
    await waitFor(() => act(window, '!!document.querySelector(\'button[aria-label="显示倒计时：提交材料"]\')'), '管理页未同步隐藏状态');
    const countdownFile = path.join(profile, 'countdowns.json');
    const persistedCountdowns = JSON.parse(await fs.readFile(countdownFile, 'utf8'));
    delete persistedCountdowns[1].theme;
    delete persistedCountdowns[1].ink;
    delete persistedCountdowns[1].layout;
    await fs.writeFile(countdownFile, JSON.stringify(persistedCountdowns));
    await fs.writeFile(fixtures, JSON.stringify(expected));
    await fs.writeFile(path.join(directory, 'countdown-widget.png'), (await card(first.id).capturePage()).toPNG());
    console.log('Countdown creation QA passed: four native window sizes, circular clipping, long durations, editor controls and saved placement.');
    return;
  }

  if (process.env.HOMEWORK_CLOCK_QA_TODO_API) {
    const { safeStorage } = require('electron');
    const profile = app.getPath('userData');
    const storedKey = path.join(profile, 'todo-api.bin');
    const readKey = async () => (await safeStorage.decryptStringAsync(await fs.readFile(storedKey))).result;
    const apiStatus = () => act(window, 'window.clock.todoApiStatus()');
    let status = await apiStatus();
    const post = (data, token, headers = {}, url = status.url) => fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
      body: JSON.stringify(data)
    });
    const get = (route, token, headers = {}) => fetch(status.baseUrl + '/v1/' + route, {
      headers: { ...(token && { Authorization: `Bearer ${token}` }), ...headers }
    });
    const input = { title: 'AI 实验答辩', at: '2026-12-10T18:00:17.450+08:00', color: '#8ad4b0', theme: 'liquid', ink: 'dark', layout: 'tiles' };
    const countdownKey = { 'Idempotency-Key': 'qa-countdown' };
    const postCountdown = (data, token, headers) => post(data, token, headers, status.baseUrl + '/v1/countdowns');
    const findCard = id => BrowserWindow.getAllWindows().find(win => win !== window
      && new URL(win.webContents.getURL() || 'about:blank').searchParams.get('countdown') === id);
    if (process.env.HOMEWORK_CLOCK_QA_TODO_API === 'restore') {
      assert.equal(status.enabled, true);
      const key = await readKey();
      const repeated = await post({ title: 'AI 新增待办' }, key, { 'Idempotency-Key': 'qa-same-task' });
      assert.equal(repeated.status, 200);
      assert.equal((await repeated.json()).repeated, true);
      const saved = JSON.parse(await fs.readFile(path.join(profile, 'todos.json'), 'utf8'));
      assert.equal(saved.filter(todo => todo.title === 'AI 新增待办').length, 1);
      const countdown = await postCountdown(input, key, countdownKey);
      assert.equal(countdown.status, 200);
      const { countdown: restored } = await countdown.json();
      await waitFor(() => findCard(restored.id)?.isVisible(), '重启后倒计时卡片未恢复');
      const response = await get('countdowns', key);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).countdowns, [restored]);
    } else {
      assert.equal(status.enabled, false);
      await click('组件设置');
      const apiToggle = 'document.querySelector(".todo-api-options input[type=checkbox]")';
      await waitFor(() => act(window, `${apiToggle}?.disabled === false`), 'AI 待办开关未就绪');
      await act(window, `${apiToggle}.click()`);
      await waitFor(async () => (await apiStatus()).enabled, 'AI 待办接口未启动');
      status = await apiStatus();
      assert.equal(new URL(status.url).hostname, '127.0.0.1');
      const key = await readKey();
      assert.ok(!(await fs.readFile(storedKey)).includes(key));
      assert.equal((await post({ title: '未经授权' })).status, 401);
      assert.equal((await post({ title: '跨站请求' }, key, { Origin: 'https://example.invalid' })).status, 403);
      assert.equal((await post({ title: '日期无效', date: '2026-02-30' }, key)).status, 400);
      assert.equal((await post({ title: '长'.repeat(1500) }, key)).status, 413);
      assert.equal((await get('data')).status, 401);
      assert.equal((await get('data', key, { Origin: 'https://example.invalid' })).status, 403);
      assert.equal((await get('timetable', key)).status, 200);
      assert.equal((await postCountdown(input)).status, 401);
      assert.equal((await postCountdown({ ...input, at: '2026-02-30T18:00+08:00' }, key)).status, 400);
      assert.equal((await postCountdown({ ...input, at: '2026-12-10T18:00' }, key)).status, 400);
      assert.equal((await postCountdown({ ...input, theme: 'unknown' }, key)).status, 400);
      assert.equal((await postCountdown({ ...input, id: 'invalid' }, key)).status, 400);
      await click('返回');
      await click('每日待办');
      await waitFor(() => act(window, 'document.querySelector(".todos-view") !== null'), '待办视图未打开');
      const headers = { 'Idempotency-Key': 'qa-same-task' };
      const pair = await Promise.all([post({ title: 'AI 新增待办' }, key, headers), post({ title: 'AI 新增待办' }, key, headers)]);
      assert.deepEqual(pair.map(response => response.status).sort(), [200, 201]);
      const created = await pair.find(response => response.status === 201).json();
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' }).format(Date.now());
      assert.equal(created.todo.date, today);
      await waitFor(() => act(window, 'document.querySelector(".todo-list")?.textContent.includes("AI 新增待办")'), '接口写入后待办未即时刷新');
      assert.equal((await post({ title: '同标识不同任务' }, key, headers)).status, 409);
      const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
      assert.equal((await post({ title: '明日 AI 待办', date: tomorrow }, key)).status, 201);
      await click('后一天');
      await waitFor(() => act(window, 'document.querySelector(".todo-list")?.textContent.includes("明日 AI 待办")'), '指定日期待办未显示');
      await act(window, 'document.querySelector(".todo-check").click()');
      await waitFor(() => act(window, '!!document.querySelector(".todo-check")?.checked'), '原有待办勾选未更新');
      const schedule = { title: '实验室预约', at: Date.parse('2026-12-10T07:00Z'), color: '#7db4ff' };
      assert.equal((await act(window, `window.clock.saveSchedule(${JSON.stringify(schedule)})`)).items.length, 1);
      window.hide();
      assert.equal((await post({ title: '托盘状态新增' }, key)).status, 201);
      const results = await Promise.all([postCountdown(input, key, countdownKey), postCountdown(input, key, countdownKey)]);
      assert.deepEqual(results.map(response => response.status).sort(), [200, 201]);
      const { countdown } = await results.find(response => response.status === 201).json();
      assert.equal(countdown.at, '2026-12-10T10:00:17.450Z');
      assert.equal(countdown.theme, 'liquid');
      assert.equal(countdown.ink, 'dark');
      assert.equal(countdown.layout, 'tiles');
      assert.equal(countdown.visible, true);
      assert.equal(countdown.position, undefined);
      assert.equal((await postCountdown({ ...input, at: countdown.at }, key, countdownKey)).status, 200);
      assert.equal((await postCountdown({ ...input, title: '另一场答辩' }, key, countdownKey)).status, 409);
      await waitFor(() => findCard(countdown.id)?.isVisible(), 'API 新增倒计时未显示桌面卡片');
      const response = await get('data', key);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const snapshot = await response.json();
      assert.deepEqual(Object.keys(snapshot), ['timeZone', 'todos', 'countdowns', 'schedules', 'homework', 'timetable']);
      assert.equal(snapshot.timeZone, 'Asia/Shanghai');
      assert.equal(snapshot.todos.items.find(item => item.title === '明日 AI 待办').done, true);
      assert.deepEqual(snapshot.countdowns, [countdown]);
      assert.equal(snapshot.schedules[0].at, '2026-12-10T07:00:00.000Z');
      assert.equal(snapshot.homework.items.length, 3);
      assert.equal(snapshot.homework.items[0].url, undefined);
      assert.equal(snapshot.homework.items[0].deadline, '2026-11-09T15:59:00.000Z');
      const fixture = JSON.parse(await fs.readFile(path.join(profile, 'timetable.json'), 'utf8'));
      assert.equal(snapshot.timetable.lessons[0].start, new Date(fixture.lessons[0].start).toISOString());
      for (const route of ['todos', 'countdowns', 'schedules', 'homework', 'timetable']) {
        assert.deepEqual((await (await get(route, key)).json())[route], snapshot[route]);
      }
      window.showInactive();
      await act(findCard(countdown.id), 'document.querySelector(\'button[aria-label="编辑倒计时"]\').click()');
      await waitFor(() => act(window, 'document.querySelector(".schedule-editor input[name=title]")?.value === "AI 实验答辩"'), '无法编辑 API 创建的倒计时');
      await act(window, 'document.querySelector(".schedule-editor").requestSubmit()');
      await waitFor(() => act(window, '!!document.querySelector(".countdowns-list")'), 'API 倒计时编辑未保存');
      assert.equal((await (await get('countdowns', key)).json()).countdowns[0].at, countdown.at);
      await click('返回首页');
      await click('组件设置');
      await waitFor(() => act(window, `${apiToggle}?.checked === true`), '接口设置未恢复');
      await act(window, `${apiToggle}.click()`);
      await waitFor(async () => !(await apiStatus()).enabled, '关闭后接口仍在监听');
      await assert.rejects(() => post({ title: '停用后写入' }, key));
      await waitFor(() => act(window, `${apiToggle}?.disabled === false`), '接口开关未恢复');
      await act(window, `${apiToggle}.click()`);
      await waitFor(async () => (await apiStatus()).enabled, '重新开启接口失败');
      status = await apiStatus();
      assert.ok(await readKey() !== key);
      assert.equal((await post({ title: '使用旧密钥写入' }, key)).status, 401);
      assert.equal((await get('data', key)).status, 401);
    }
    console.log('AI_API_QA_PASSED', process.env.HOMEWORK_CLOCK_QA_TODO_API);
  } else if (process.env.HOMEWORK_CLOCK_QA_SESSION) {
    const { WORK_URL } = require('./homework.cjs');
    const profile = path.join(directory, 'profile');
    const portal = session.fromPartition('persist:homework-clock-chaoxing');
    const cookie = { url: 'https://mooc1-api.chaoxing.com', name: 'clock-session-fixture' };
    const copy = path.join(profile, 'chaoxing-session.bin');
    const mockWork = body => portal.protocol.handle('https', request => {
      assert.equal(request.url, WORK_URL);
      return new Response(body);
    });
    assert.equal(app.getPath('userData'), profile);
    assert.equal(app.getPath('sessionData'), profile);
    assert.equal(portal.storagePath, path.join(profile, 'Partitions', 'homework-clock-chaoxing'));
    switch (process.env.HOMEWORK_CLOCK_QA_SESSION) {
      case 'seed': {
        await portal.cookies.set({ ...cookie, value: 'test-only', secure: true, httpOnly: true, sameSite: 'lax' });
        assert.equal((await portal.cookies.get(cookie))[0]?.session, true);
        mockWork('<h2>作业列表</h2>');
        assert.equal((await act(window, 'window.clock.refresh()')).status, 'ready');
        assert.equal((await fs.readFile(copy)).includes(Buffer.from('test-only')), false);
        break;
      }
      case 'restore-and-logout': {
        const [restored] = await portal.cookies.get(cookie);
        assert.equal(restored?.value, 'test-only');
        assert.equal(restored.session && restored.httpOnly && restored.secure && restored.hostOnly, true);
        mockWork('<h2>作业列表</h2>');
        assert.equal((await act(window, 'window.clock.refresh()')).status, 'ready');
        await act(window, 'window.clock.logout()');
        assert.deepEqual(await portal.cookies.get(cookie), []);
        await assert.rejects(fs.access(copy), { code: 'ENOENT' });
        break;
      }
      case 'verify-logout':
        assert.deepEqual(await portal.cookies.get(cookie), []);
        break;
      case 'restore-and-reject':
        assert.equal((await portal.cookies.get(cookie))[0]?.value, 'test-only');
        mockWork('<h2>请先登录</h2>');
        assert.equal((await act(window, 'window.clock.refresh()')).status, 'login');
        await assert.rejects(fs.access(copy), { code: 'ENOENT' });
        break;
      default:
        throw new Error('Unknown session fixture');
    }
    console.log('SESSION_FIXTURE_SMOKE_PASSED', process.env.HOMEWORK_CLOCK_QA_SESSION);
  } else if (process.env.HOMEWORK_CLOCK_QA_SCHEDULES) {
    const schedule = 'document.querySelector(".assignment:has(.schedule-dot)")';
    const populate = values => act(window, `(() => {
      const form = document.querySelector('.schedule-editor');
      for (const [field, value] of Object.entries(${JSON.stringify(values)})) form.elements[field].value = value;
      form.requestSubmit();
    })()`);
    await waitFor(() => act(window, 'document.querySelector(\'button[aria-label="新建日程"]\')?.disabled === false'), '日程入口没有就绪');
    await click('新建日程');
    await waitFor(() => act(window, '!!document.querySelector(".schedule-editor")'), '日程表单未打开');
    await populate({ title: '自习', date: '2026-11-09', time: '19:30', color: '#a64564' });
    await waitFor(() => act(window, `${schedule}?.textContent.includes('19:30')`), '日程时间未出现在首页');
    assert.equal(await act(window, `${schedule}.querySelector('.countdown').textContent`), '剩 1 小时');
    assert.equal(await act(window, `${schedule}.querySelector('.countdown').dataset.tone`), 'urgent');
    assert.equal(await act(window, `${schedule}.parentElement.querySelector('.assignment-todo')`), null);
    assert.equal(await act(window, `${schedule}.querySelector('.schedule-dot').style.backgroundColor`), 'rgb(166, 69, 100)');
    assert.equal(await act(window, 'document.querySelector(".timeline .assignment strong").textContent'), '自习');

    await act(window, `${schedule}.click()`);
    await waitFor(() => act(window, 'document.querySelector(".schedule-editor input[type=color]")?.value === "#a64564"'), '编辑页未保留自选色');
    await populate({ title: '小组讨论', date: '2026-11-10', time: '20:15', color: '#4664bd' });
    await waitFor(() => act(window, `${schedule}?.textContent.includes('小组讨论')`), '未保存日程修改');
    const { createSchedules } = require('./schedules.cjs');
    const loaded = createSchedules(path.join(directory, 'profile')).items;
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].at, Date.parse('2026-11-10T20:15:00+08:00'));
    assert.equal(loaded[0].color, '#4664bd');
    window.reload();
    await waitFor(() => act(window, `${schedule}?.textContent.includes('20:15')`), '重载后日程未显示');
    await act(window, `${schedule}.click()`);
    await waitFor(() => act(window, '!!document.querySelector(".schedule-delete")'), '没有删除日程入口');
    await act(window, 'document.querySelector(".schedule-delete").click()');
    await waitFor(() => act(window, 'document.querySelector(".schedule-delete")?.textContent === "确认删除"'), '删除确认未出现');
    await act(window, 'document.querySelector(".schedule-delete").click()');
    await waitFor(() => act(window, `!${schedule} && !document.querySelector('.schedule-editor')`), '删除后日程未移除');
    assert.deepEqual(createSchedules(path.join(directory, 'profile')).items, []);
    console.log('SCHEDULE_FIXTURE_SMOKE_PASSED');

    await click('每日待办');
    await waitFor(() => act(window, 'document.querySelector(".todos-view time")?.dateTime === "2026-11-09"'), '未默认展示北京时间当天');
    const addTodo = title => act(window, `(() => {
      const form = document.querySelector('.todo-add');
      form.elements.title.value = ${JSON.stringify(title)};
      form.requestSubmit();
    })()`);
    const checkbox = 'document.querySelector(".todo-list input")';
    await addTodo('复习指针');
    await waitFor(() => act(window, `${checkbox}?.checked === false`), '未添加待办');
    await act(window, `${checkbox}.click()`);
    await waitFor(() => act(window, 'document.querySelector(".todos-view .subview-meta").textContent === "1/1"'), '未保存勾选');
    await click('后一天');
    await waitFor(() => act(window, 'document.querySelector(".todos-view time").dateTime === "2026-11-10" && !document.querySelector(".todo-list")'), '待办跨日期混合');
    await addTodo('整理笔记');
    await waitFor(() => act(window, 'document.querySelector(".todo-list label")?.textContent === "整理笔记"'), '未保存次日待办');
    await act(window, 'document.querySelector(".todos-view .subview-footer button").click()');
    await waitFor(() => act(window, `${checkbox}?.checked === true && document.querySelector(".todo-list label").textContent === "复习指针"`), '回到今天后勾选丢失');
    const { createTodos } = require('./todos.cjs');
    assert.deepEqual(createTodos(path.join(directory, 'profile')).state.items.map(({ title, date, done }) => [title, date, done]), [
      ['复习指针', '2026-11-09', true], ['整理笔记', '2026-11-10', false]
    ]);
    window.reload();
    await waitFor(() => act(window, 'Boolean(document.querySelector(".home-view"))'), '待办重载后组件加载失败');
    await click('每日待办');
    await waitFor(() => act(window, `${checkbox}?.checked === true`), '重载后勾选状态丢失');
    await screenshot('daily-todos');
    await act(window, `${checkbox}.click()`);
    await waitFor(() => act(window, 'document.querySelector(".todos-view .subview-meta").textContent === "0/1"'), '无法取消勾选');
    await click('删除待办：复习指针');
    await waitFor(() => act(window, 'Boolean(document.querySelector(".todo-empty"))'), '未删除待办');
    assert.deepEqual(createTodos(path.join(directory, 'profile')).state.items.map(item => item.title), ['整理笔记']);
    await click('返回首页');
    await act(window, 'window.clock.sizePreset("small")');
    await act(window, 'document.querySelector(\'button[aria-label="组件设置"]\').click()');
    await waitFor(() => act(window, 'window.innerWidth <= 330 && !!document.querySelector(".theme-options")'), '小尺寸设置未打开');
    await act(window, 'Array.from(document.querySelectorAll(".theme-options button")).find(button => button.textContent.includes("轻雾白霜")).click()');
    await click('返回');
    await waitFor(() => act(window, `(() => {
      const widget = document.querySelector('.widget[data-theme=mist]');
      if (!widget) return false;
      const brand = widget.querySelector('.anchor-date-short').getBoundingClientRect();
      const actions = widget.querySelector('.actions').getBoundingClientRect();
      return brand.width > 0 && brand.right <= actions.left;
    })()`), '小尺寸下标题与工具栏重叠');
    console.log('DAILY_TODOS_FIXTURE_SMOKE_PASSED');

    const shortcut = 'document.querySelector(".assignment-todo button")';
    await waitFor(() => act(window, `${shortcut}?.disabled === false`), '作业快捷按钮未显示');
    assert.equal(await act(window, `(() => {
      const button = ${shortcut};
      const row = button.closest('.assignment-row');
      const timer = row.querySelector('.countdown');
      return timer.getBoundingClientRect().right <= button.getBoundingClientRect().left
        && button.getBoundingClientRect().right <= row.getBoundingClientRect().right;
    })()`), true);
    await act(window, `(() => { const button = ${shortcut}; button.click(); button.click(); })()`);
    await waitFor(() => act(window, `${shortcut}?.getAttribute('aria-label').startsWith('已加入今日待办：')`), '快捷按钮未显示添加成功');
    const copied = createTodos(path.join(directory, 'profile')).state.items.filter(item => item.homeworkId);
    assert.equal(copied.length, 1);
    assert.deepEqual(copied.map(({ date, title, course, done }) => [date, title, course, done]), [
      ['2026-11-09', '极限与连续练习', '高等数学', false]
    ]);
    window.reload();
    await waitFor(() => act(window, `${shortcut}?.getAttribute('aria-label').startsWith('已加入今日待办：')`), '重载后未显示已加入状态');
    await click('每日待办');
    await waitFor(() => act(window, 'document.querySelector(".todo-item-copy small")?.textContent === "高等数学"'), '今日清单未显示作业课程');
    await click('删除待办：极限与连续练习');
    await waitFor(() => act(window, 'Boolean(document.querySelector(".todo-empty"))'), '未删除快捷加入的待办');
    await click('返回首页');
    await waitFor(() => act(window, `${shortcut}?.disabled === false`), '移除待办后无法重新添加');
    console.log('HOMEWORK_TODO_SHORTCUT_SMOKE_PASSED');

    await act(window, 'window.clock.sizePreset("default")');
    await click('组件设置');
    await act(window, 'Array.from(document.querySelectorAll(".theme-options button")).find(button => button.textContent.includes("暖白皱笺")).click()');
    await waitFor(() => act(window, 'window.clock.setup().then(value => value.settings.theme === "cotton")'), '暖白皱笺未保存');
    await click('返回');
    await waitFor(() => act(window, 'document.querySelector(\'.widget[data-theme="cotton"] .day[data-today="true"]\') !== null'), '暖白皱笺或今日分组未显示');
    assert.equal(await act(window, 'getComputedStyle(document.querySelector(".material")).backgroundColor'), 'rgb(246, 238, 223)');
    assert.notEqual(await act(window, 'getComputedStyle(document.querySelector(\'.countdown[data-tone="urgent"]\')).borderTopStyle'), 'none');
    await screenshot('cotton-agenda');
    await act(window, 'window.clock.resize("step", -320, -320)');
    await waitFor(() => act(window, 'Math.abs(innerWidth - 320) <= 1'), '未达到最小窗口宽度');
    assert.equal(await act(window, `Array.from(document.querySelectorAll('.assignment-todo button')).every(button => {
      const row = button.closest('.assignment-row');
      const timer = row.querySelector('.countdown');
      const timerBounds = timer.getBoundingClientRect();
      const buttonBounds = button.getBoundingClientRect();
      return timer.scrollWidth <= timer.clientWidth && buttonBounds.left >= timerBounds.right
        && buttonBounds.right <= row.getBoundingClientRect().right;
    })`), true);
    await act(window, `${shortcut}.click()`);
    await waitFor(() => act(window, `${shortcut}?.disabled === true`), '暖白皱笺快捷添加失败');
    await click('每日待办');
    await waitFor(() => act(window, `${checkbox}?.checked === false`), '暖白皱笺待办未显示');
    await act(window, `${checkbox}.click()`);
    await waitFor(() => act(window, `${checkbox}?.checked === true`), '暖白皱笺待办无法勾选');
    await screenshot('cotton-todos-small');
    const todoInset = await act(window, `(() => {
      const row = document.querySelector('.todo-list li').getBoundingClientRect();
      const content = document.querySelector('.content').getBoundingClientRect();
      return content.bottom - row.bottom;
    })()`);
    assert.ok(todoInset >= 0, '首条待办被裁切 ' + Math.abs(todoInset) + ' 像素');
    window.reload();
    await waitFor(() => act(window, 'document.querySelector(".widget")?.dataset.theme === "cotton"'), '重载后暖白皱笺未恢复');
    const cottonSettings = JSON.parse(await fs.readFile(path.join(directory, 'profile', 'settings.json'), 'utf8'));
    assert.equal(cottonSettings.theme, 'cotton');
    console.log('COTTON_THEME_FIXTURE_SMOKE_PASSED');
  } else if (process.env.HOMEWORK_CLOCK_QA_TIMETABLE === 'live') {
    await click('打开课表');
    await chooseSchool('兰州大学');
    const official = () => BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('https://sso.lzu.edu.cn/'));
    await waitFor(async () => !!official() && await act(official(), '!!document.querySelector(\'input[type="password"]\')'), '官方统一认证页面未显示密码框');
    assert.equal(official().webContents.getLastWebPreferences().sandbox, true);
    console.log('TIMETABLE_LIVE_LOGIN_PAGE_PASSED');
  } else if (process.env.HOMEWORK_CLOCK_QA_TIMETABLE) {
    const { ENTRY } = require('./timetable.cjs');
    const origin = new URL(ENTRY).origin;
    const partition = session.fromPartition('persist:homework-clock-lzu');
    const html = page => new Response('<!doctype html><meta charset="utf-8">' + page, { headers: { 'content-type': 'text/html' } });
    partition.protocol.handle('https', request => {
      const url = new URL(request.url);
      if (request.url === ENTRY) return Response.redirect('https://sso.lzu.edu.cn/login');
      if (url.hostname === 'sso.lzu.edu.cn') return html(`<a id="continue" href="${origin}/academic/qa">模拟登录</a>`);
      if (url.pathname === '/academic/qa') return html(`<iframe name="menuFrame" src="/academic/qa-menu"></iframe><iframe src="${ENTRY}?fixture=1"></iframe>`);
      if (url.pathname === '/academic/qa-menu') return html('<a href="/academic/qa-calendar">校历</a>');
      if (url.pathname === '/academic/qa-calendar') return html('<table class="datalist"><tr><td>2026</td><td>秋</td><td></td><td>2026-11-09</td><td>20</td><td>星期一</td></tr></table>');
      assert.equal(request.url, ENTRY + '?fixture=1');
      return html('<eduaffair:ctrt year="46" term="2"></eduaffair:ctrt>' +
        '<table><tr><th>课程号</th><th>课程名称</th><th>上课时间地点</th></tr>' +
        '<tr><td>01</td><td>双周数学</td><td>1-16周双周　星期二　第1节　教学楼 A203<br>第3、5周　周天　第2节　实验楼</td></tr>' +
        '<tr><td>02</td><td>已结束课程</td><td>第1周　星期二　07:00-08:00　教室</td></tr>' +
        '<tr><td>03</td><td>正在上课的课程</td><td>第1周　星期二　第1节　教室</td></tr>' +
        '<tr><td>04</td><td>稍后开课</td><td>第1周　星期二　第2节　教室</td></tr>' +
        '<tr><td>05</td><td>明天的课程</td><td>第1周　星期三　第1节　教室</td></tr></table>' +
        '<table><tr><td>1</td><td>第1节</td><td>08:00 -- 08:50</td></tr>' +
        '<tr><td>2</td><td>第2节</td><td>09:00 -- 09:50</td></tr></table>');
    });
    await act(window, 'Date.now = () => Date.parse("2026-11-10T08:25:00+08:00"); true');
    await click('打开课表');
    await chooseSchool('兰州大学');
    const login = () => BrowserWindow.getAllWindows().find(item => item.webContents.getURL() === 'https://sso.lzu.edu.cn/login');
    await waitFor(() => !!login(), '兰大登录窗口未打开');
    assert.equal(login().webContents.session, partition);
    assert.equal(login().webContents.getLastWebPreferences().sandbox, true);
    await act(login(), 'document.querySelector("#continue").click()');
    await waitFor(() => act(window, 'document.querySelectorAll(".lesson-list li").length === 6'), '未从已加载的课表 iframe 得到预览');
    assert.equal(await act(window, 'document.querySelector(\'input[name="monday"]\').value'), '2026-11-09');
    await screenshot('timetable-preview');
    await act(window, 'document.querySelector("form").requestSubmit()');
    await waitFor(() => act(window, 'document.querySelector(".lesson-day")?.textContent.includes("稍后开课")'), '默认课表未显示今日剩余课程');
    assert.deepEqual(await act(window, 'Array.from(document.querySelectorAll(".lesson-list strong"), node => node.textContent)'), ['正在上课的课程', '稍后开课']);
    await act(window, 'document.querySelector(".pill-toggle").click()');
    await waitFor(() => act(window, 'Boolean(document.querySelector(".subview-nav"))'), '确认后未显示周课表');
    await click('下一周');
    await waitFor(() => act(window, 'document.querySelector(".lesson-day")?.textContent.includes("教学楼 A203")'), '单双周筛选没有显示第 2 周课程');
    await screenshot('timetable-week');
    await click('返回首页');
    await waitFor(() => act(window, 'document.querySelector(".next-lesson")?.textContent.includes("正在上课")'), '作业视图未显示正在上的课');
    await act(window, 'Date.now = () => Date.parse("2026-11-10T09:50:00+08:00"); true');
    await waitFor(() => act(window, 'document.querySelector(".next-lesson")?.textContent.includes("明天的课程")'), '今日课程结束后未显示下一节课');
    assert.match(await act(window, 'document.querySelector(".next-lesson").textContent'), /周三 08:00/);
    assert.deepEqual(await act(window, `(() => {
      const lesson = document.querySelector('.next-lesson[data-today="false"]');
      return [getComputedStyle(lesson.querySelector('b')).color,
        getComputedStyle(lesson.querySelector('.next-lesson-dot')).backgroundColor];
    })()`), ['rgb(189, 226, 255)', 'rgb(189, 226, 255)'], '隔日课程应保留课表强调色');
    await click('打开课表');
    await waitFor(() => act(window, '!!document.querySelector(".lesson-day")'), '课表页未显示下一节课');
    assert.match(await act(window, 'document.querySelector(".lesson-day").textContent'), /下一节 11月11日 周三.*明天的课程.*08:00–08:50/);
    await act(window, 'Date.now = () => Date.parse("2027-03-01T08:00:00+08:00"); true');
    await waitFor(() => act(window, 'document.querySelector(".timetable-hint")?.textContent === "本学期没有后续课程安排。"'), '课表已经结束时未显示空状态');
    await click('返回首页');
    await waitFor(() => act(window, 'Boolean(document.querySelector(\'.top-anchor [aria-label="打开课表"]\')) && !document.querySelector(".next-lesson")'), '最后一节课结束后课表入口消失');
    await click('打开课表');
    await waitFor(() => act(window, 'document.querySelector(".subview-footer")?.textContent.includes("重新导入")'), '本学期结束后无法重新导入课表');
    const persisted = JSON.parse(await fs.readFile(path.join(directory, 'profile', 'timetable.json'), 'utf8'));
    assert.equal(persisted.lessons.length, 14);
    assert.equal(persisted.lessons[0].start, Date.parse('2026-11-10T07:00:00+08:00'));
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    console.log('TIMETABLE_FIXTURE_SMOKE_PASSED');

    const calendar = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Class Schedule Fixture//CN',
      'BEGIN:VEVENT', 'UID:lesson@example.com', 'DTSTART;TZID=Asia/Shanghai:20260908T080000',
      'DTEND;TZID=Asia/Shanghai:20260908T094000', 'RRULE:FREQ=WEEKLY;COUNT=4',
      'EXDATE;TZID=Asia/Shanghai:20260915T080000', 'SUMMARY:跨校样例课程',
      'LOCATION:教学楼 A201', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:lesson@example.com', 'RECURRENCE-ID;TZID=Asia/Shanghai:20260922T080000',
      'DTSTART:20260923T020000Z', 'DTEND:20260923T034000Z', 'SUMMARY:跨校样例课程',
      'LOCATION:调课教室', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:holiday@example.com', 'DTSTART;VALUE=DATE:20260915',
      'SUMMARY:全天日历事件', 'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
    await act(window, `(() => {
      const input = document.querySelector('input[type=file]');
      const transfer = new DataTransfer();
      transfer.items.add(new File([${JSON.stringify(calendar)}], '课程.ics', { type: 'text/calendar' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(() => act(window, 'document.querySelector(".subview-title")?.textContent === "核对课表"'), '日历预览未显示');
    assert.equal(await act(window, 'document.querySelector(\'input[name="monday"]\').value'), '2026-09-07');
    assert.equal(await act(window, 'document.querySelectorAll(".lesson-list li").length'), 3);
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'profile', 'timetable.json'), 'utf8')).lessons.length, 14);
    await act(window, 'document.querySelector(\'input[name="monday"]\').value = "2026-08-31"; document.querySelector("form").requestSubmit()');
    await waitFor(() => act(window, 'document.querySelector(".subview-footer")?.textContent.includes("日历课表")'), '日历课表未保存');
    const imported = JSON.parse(await fs.readFile(path.join(directory, 'profile', 'timetable.json'), 'utf8'));
    assert.deepEqual(imported.lessons.map(({ start, week }) => [start, week]), [
      [Date.parse('2026-09-08T08:00:00+08:00'), 2], [Date.parse('2026-09-23T10:00:00+08:00'), 4],
      [Date.parse('2026-09-29T08:00:00+08:00'), 5]
    ]);
    console.log('CALENDAR_IMPORT_FIXTURE_SMOKE_PASSED');

    const { schoolIndex } = require('./timetable-schools.cjs');
    const target = schoolIndex.get('moe:4111010034');
    const second = session.fromPartition('persist:homework-clock-moe-4111010034');
    const loginUrl = target.base + '/xtgl/login_slogin.html';
    const dashboard = target.base + '/xtgl/index_initMenu.html';
    let authenticated = false;
    let courseVisits = 0;
    second.protocol.handle('https', async request => {
      const url = new URL(request.url);
      assert.equal(url.origin, new URL(target.base).origin);
      if (url.href === target.course) {
        courseVisits++;
        return authenticated ? html('<select name="xnm"><option>2026</option></select><select name="xqm"><option>3</option></select>')
          : Response.redirect(loginUrl);
      }
      if (url.href === loginUrl) return html(`<a id="signed-in" href="${dashboard}">模拟登录</a>`);
      if (url.href === dashboard) { authenticated = true; return html('<h2>学生教务首页</h2>'); }
      assert.equal(request.method, 'POST');
      const body = new URLSearchParams(await request.text());
      assert.equal(body.get('xnm'), '2026');
      assert.equal(body.get('xqm'), '3');
      if (url.pathname.endsWith('/xskbcx_cxRjc.html')) return Response.json([
        { jc: '1', qssj: '0800', jssj: '0845' }, { jc: '2', qssj: '0855', jssj: '0940' }
      ]);
      if (url.pathname.endsWith('/xskbcx_cxXsgrkb.html')) return Response.error();
      assert.match(url.pathname, /xskbcx_cxXsKb\.html$/);
      return Response.json({ kbList: [{ kcmc: '央财模拟课程', xqj: '2', zcd: '1-4周(双)', jcs: '1-2', cdmc: 'A201' }] });
    });
    await act(window, 'Array.from(document.querySelectorAll("footer button")).find(node => node.textContent === "重新导入").click()');
    await waitFor(() => act(window, 'document.querySelector(".timetable-hint")?.textContent.includes("3,377")'), '未加载全国高校名录');
    assert.equal(await act(window, 'document.querySelectorAll(".school-result").length'), 20);
    await act(window, 'Array.from(document.querySelectorAll("button")).find(node => node.textContent === "显示更多学校").click()');
    await waitFor(() => act(window, 'document.querySelectorAll(".school-result").length === 40'), '学校名录分页未显示');
    await searchSchools('广西');
    await waitFor(() => act(window, 'document.querySelector(".school-result small")?.textContent.includes("广西")'), '省份搜索未显示');
    await searchSchools('台湾大学');
    await waitFor(() => act(window, 'document.querySelector(".school-result strong")?.textContent === "國立臺灣大學"'), '简体校名搜索未显示');

    const external = [];
    const originalOpenExternal = shell.openExternal;
    shell.openExternal = async address => { external.push(address); };
    try {
      await chooseSchool('國立臺灣大學');
      await waitFor(() => act(window, 'document.querySelector(".timetable-hint")?.textContent.includes("已在浏览器打开")'), '教务入口未显示打开状态');
      assert.deepEqual(external, ['https://course.ntu.edu.tw/']);
      await searchSchools('国家开放大学');
      await waitFor(() => act(window, 'document.querySelector(".school-result strong")?.textContent === "国家开放大学"'), '成人高校未显示');
      await chooseSchool('国家开放大学');
      await waitFor(() => act(window, 'document.querySelector(".timetable-hint")?.textContent.includes("已搜索")'), '无直达入口学校未打开搜索');
      const search = new URL(external[1]);
      assert.equal(search.origin, 'https://cn.bing.com');
      assert.match(search.searchParams.get('q'), /^国家开放大学 官方/);
      assert.equal(BrowserWindow.getAllWindows().length, 1);
    } finally { shell.openExternal = originalOpenExternal; }

    await searchSchools('河工大');
    await waitFor(() => act(window, 'document.querySelector(".school-result strong")?.textContent === "河南工业大学"'), '学校简称搜索未正确筛选');
    await searchSchools('中央财经大学');
    await waitFor(() => act(window, 'document.querySelector(".school-result strong")?.textContent === "中央财经大学"'), '新收录的正方学校未显示');
    await screenshot('school-directory');
    await chooseSchool('中央财经大学');
    const secondLogin = () => BrowserWindow.getAllWindows().find(item => item.webContents.getURL() === loginUrl);
    await waitFor(() => Boolean(secondLogin()), '选中学校后未跳转到对应教学系统');
    assert.equal(secondLogin().webContents.session, second);
    await act(secondLogin(), 'document.querySelector("#signed-in").click()');
    await waitFor(() => act(window, 'document.querySelector(".lesson-list strong")?.textContent === "央财模拟课程"'), '登录后未自动打开课表并读取');
    assert.equal(courseVisits, 2);
    assert.match(await act(window, 'document.querySelector(".lesson-list").textContent'), /08:00–09:40.*第 2、4 周/);
    await act(window, 'document.querySelector(\'input[name="monday"]\').value = "2026-08-31"; document.querySelector("form").requestSubmit()');
    await waitFor(() => act(window, 'document.querySelector(".subview-footer")?.textContent.includes("中央财经大学")'), '选定学校未保存');
    console.log('SCHOOL_SEARCH_AND_ZHENGFANG_FIXTURE_SMOKE_PASSED');
  } else if (process.env.HOMEWORK_CLOCK_QA_PORTAL) {
    await verifyPortal(window);
  } else if (process.env.HOMEWORK_CLOCK_QA_LAYOUT) {
    await act(window, 'window.clock.sizePreset("default")');
    await click('组件设置');
    await waitFor(() => act(window, '!!document.querySelector(".window-options")'), '大小与位置设置未显示');
    await click('大尺寸');
    await waitFor(() => window.getBounds().width === 500, '大尺寸预设没有改变窗口');
    await click('默认尺寸');
    await waitFor(() => window.getBounds().width === 384, '默认尺寸预设没有恢复窗口');
    await click('移到右上角');
    const area = screen.getDisplayMatching(window.getBounds()).workArea;
    const docked = window.getBounds();
    assert.equal(docked.x + docked.width, area.x + area.width - 14);
    assert.equal(docked.y, area.y + 14);
    await waitFor(() => act(window, 'document.querySelector(".resize-grip").dataset.position === "bottom-left"'), '缩放手柄没有移到内侧');
    await act(window, 'document.querySelector(".resize-grip").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}))');
    await waitFor(() => window.getBounds().width > docked.width, '键盘缩放没有生效');
    assert.equal(window.getBounds().x + window.getBounds().width, docked.x + docked.width);
    await click('返回');
    await act(window, 'document.activeElement.blur()');
    const beforeDrag = window.getBounds();
    await act(window, `(() => {
      const grip = document.querySelector('.resize-grip');
      // Feed the renderer path deterministically. Synthetic pointers are ineligible for capture.
      grip.setPointerCapture = () => {};
      const send = (type, screenX, screenY) => grip.dispatchEvent(new PointerEvent(type, {
        pointerId: 7, pointerType: 'mouse', bubbles: true, button: 0, screenX, screenY
      }));
      send('pointerdown', 200, 200);
      send('pointermove', 248, 165);
      send('pointerup', 248, 165);
      delete grip.setPointerCapture;
    })()`);
    await waitFor(() => window.getBounds().width < beforeDrag.width && window.getBounds().height < beforeDrag.height, '拖动手柄未缩放实际窗口');
    await pause(180);
    const size = window.getBounds();
    const moveNear = { x: area.x + 32, y: area.y + area.height - size.height - 31 };
    window.emit('will-move');
    window.setPosition(moveNear.x, moveNear.y);
    await pause(150);
    window.emit('moved');
    await waitFor(() => act(window, 'window.clock.setup().then(v=>v.settings.corner==="bottom-left")'), '靠近左下角没有吸附');
    assert.equal(window.getBounds().x, area.x + 14);
    assert.equal(window.getBounds().y + window.getBounds().height, area.y + area.height - 14);
    await act(window, 'window.clock.change("autoSnap", false)');
    window.emit('will-move');
    window.setPosition(moveNear.x, moveNear.y);
    await pause(150);
    window.emit('moved');
    assert.deepEqual(window.getPosition(), [moveNear.x, moveNear.y]);
    await pause(320);
    const saved = JSON.parse(await fs.readFile(path.join(require('electron').app.getPath('userData'), 'settings.json'), 'utf8'));
    assert.deepEqual([saved.width, saved.height, saved.x, saved.y], [size.width, size.height, moveNear.x, moveNear.y]);
    await act(window, 'window.clock.change("autoSnap", true)');
    await act(window, 'window.clock.sizePreset("default")');
    await waitFor(() => window.getBounds().width === 384 && window.getBounds().height === 458, '恢复默认大小失败');
    await screenshot('window-layout');
    console.log('Desktop QA passed: resize grip, keyboard resize, corner docking and saved bounds.');
  } else if (process.argv.includes('--demo')) {
    await waitFor(() => act(window, 'document.querySelectorAll(".assignment").length === 3'), '示例作业未出现');
    await act(window, 'Promise.all([window.clock.change("theme", "glass"), window.clock.change("opacity", 0), window.clock.change("blur", 0), window.clock.change("pinned", false)])');
    window.reload();
    await waitFor(() => act(window, 'document.querySelectorAll(".assignment").length === 3'), '重新载入组件失败');
    assert.deepEqual(await act(window, '[...document.querySelectorAll(".countdown")].map(el => el.textContent)'), ['剩 6 小时', '剩 2 天 7 小时', '剩 4 天']);
    assert.equal(await act(window, 'document.querySelector(".content").scrollHeight <= document.querySelector(".content").clientHeight'), true);
    assert.equal(await act(window, 'document.querySelector(".date-chip").textContent'), '今天 · 11月9日');
    assert.equal(await act(window, '!!document.querySelector(".desktop-backdrop, .desktop-tint")'), false);
    if (process.env.HOMEWORK_CLOCK_QA_COUNTDOWN === '1') {
      window.setBounds({ ...window.getBounds(), width: 320, height: 320 });
      await waitFor(() => act(window, 'innerWidth === 320'), '未应用小窗口尺寸');
      assert.equal(await act(window, '[...document.querySelectorAll(".countdown")].every(el => el.scrollWidth <= el.clientWidth)'), true);
      const { state } = await act(window, 'window.clock.setup()');
      const items = state.items.map((item, index) => index === 2 ? { ...item, deadline: state.syncedAt + 82 * 3600000 } : item);
      items.push({ ...items[2], id: 'undated', title: '未提供截止时间', deadline: null });
      window.webContents.send('clock:state', { ...state, items });
      await waitFor(() => act(window, 'document.querySelectorAll(".countdown").length === 4'), '测试倒计时未显示');
      const countdowns = await act(window, '[...document.querySelectorAll(".countdown")].map(el => [el.textContent.trim(), getComputedStyle(el).color])');
      assert.deepEqual(countdowns, [
        ['剩 6 小时', 'rgb(255, 178, 163)'], ['剩 2 天 7 小时', 'rgb(255, 224, 158)'],
        ['剩 3 天', 'rgb(189, 226, 255)'], ['待交', 'rgba(255, 255, 255, 0.88)']
      ]);
      await screenshot('homework-accents');
      console.log('Countdown QA passed: 320px layout, distinct urgency colors, and neutral undated tasks.');
      return;
    }
    const transparent = await window.capturePage();
    const width = transparent.getSize().width;
    const pixels = transparent.toBitmap();
    assert.equal(pixels[(width * 60 + 3) * 4 + 3], 0, '默认主题边缘应完全透明');
    const header = await act(window, 'document.querySelector(".top-anchor").getBoundingClientRect().toJSON()');
    const scale = width / await act(window, 'innerWidth');
    const x = Math.round((header.left + header.width / 2) * scale);
    const y = Math.round((header.top + 2) * scale);
    assert.equal(pixels[(width * y + x) * 4 + 3], 0, '默认主题标题栏空白处应完全透明');
    assert.equal(await act(window, 'getComputedStyle(document.querySelector(".date-chip")).backgroundColor'), 'rgba(0, 0, 0, 0)');
    assert.equal(await act(window, 'getComputedStyle(document.querySelector(".countdown")).backgroundColor'), 'rgba(0, 0, 0, 0)');
    await screenshot('glass');
    await click('组件设置');
    await waitFor(() => act(window, 'Boolean(document.querySelector(".settings"))'), '设置未打开');
    await screenshot('settings');
    const changeRange = (label, value) => act(window, '(() => {' +
      'const slider = document.querySelector(' + JSON.stringify('input[aria-label="' + label + '"]') + ');' +
      'Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(slider,' + value + ');' +
      'slider.dispatchEvent(new Event("input", {bubbles:true})); })()');
    await changeRange('底色微雾', 24);
    const { workArea } = screen.getPrimaryDisplay();
    window.setBounds({ x: workArea.x + Math.round((workArea.width - 384) / 2),
      y: workArea.y + Math.round((workArea.height - 458) / 2), width: 384, height: 458 });
    const bounds = window.getBounds();
    const backing = new BrowserWindow({ x: bounds.x - 50, y: bounds.y - 50, width: bounds.width + 100,
      height: bounds.height + 100, frame: false, show: false, skipTaskbar: true, alwaysOnTop: true });
    try {
      await backing.loadURL('data:text/html,' + encodeURIComponent(
        '<style>body{background:repeating-linear-gradient(90deg,#202020 0 12px,#e0e0e0 12px 24px)}</style>'
      ));
      backing.showInactive();
      window.setAlwaysOnTop(true);
      window.moveTop();
      await pause(180);
      await changeRange('背景模糊', 1);
      await waitFor(() => act(window, '!!document.querySelector(".desktop-backdrop")?.naturalWidth'), '未显示捕获的桌面背景');
      await click('返回');
      const contrast = async () => {
        await pause(230);
        const image = await window.capturePage();
        const { width, height } = image.getSize();
        const pixels = image.toBitmap();
        const row = Math.round(height * .87);
        const values = Array.from({ length: 120 }, (_, i) => pixels[(row * width + 120 + i) * 4]);
        return Math.max(...values) - Math.min(...values);
      };
      let subtle = await contrast();
      for (let attempt = 0; subtle <= 100 && attempt < 3; attempt++) {
        await act(window, 'window.clock.refresh()');
        subtle = await contrast();
      }
      await click('组件设置');
      await waitFor(() => act(window, '!!document.querySelector(".settings")'), '设置未重新打开');
      await changeRange('背景模糊', 15);
      await click('返回');
      const strong = await contrast();
      assert.ok(subtle > 100 && strong < subtle * .55, '模糊滑块应降低背景条纹的像素对比：' + subtle + ' → ' + strong);
      assert.equal(await act(window, 'getComputedStyle(document.querySelector(".assignment")).filter'), 'none');
      await screenshot('desktop-blur-15');
      await click('组件设置');
      await waitFor(() => act(window, '!!document.querySelector(".settings")'), '设置未重新打开');
      await changeRange('背景模糊', 0);
      await waitFor(() => act(window, '!document.querySelector(".desktop-backdrop")'), '背景模糊归零后应恢复透明');
      console.log('Desktop blur QA passed: real backdrop contrast ' + subtle + ' → ' + strong);

      if (process.env.HOMEWORK_CLOCK_QA_LIQUID) {
        const { desktopCapturer } = require('electron');
        const getSources = desktopCapturer.getSources;
        let captures = 0;
        desktopCapturer.getSources = (...args) => { captures++; return getSources.apply(desktopCapturer, args); };
        try {
          await act(window, 'window.clock.change("liveBackdrop", true)');
          await act(window, `[...document.querySelectorAll('.theme-options button')].find(button => button.textContent === '液态玻璃').click()`);
          await waitFor(() => act(window, 'document.querySelector(".widget[data-theme=liquid] .liquid-material") !== null'), '液态玻璃未显示');
          assert.equal(await act(window, '!!document.querySelector(".glass-options input[type=range], .glass-options input[type=checkbox]")'), false);
          await act(window, `[...document.querySelectorAll('.segmented button')].find(button => button.textContent === '深墨').click()`);
          await click('返回');
          await act(window, 'window.clock.change("blur", 11)');
          window.setBounds({ ...bounds, x: bounds.x + 8, width: 320, height: 320 });
          await act(window, 'window.clock.refresh()');
          window.reload();
          await waitFor(() => act(window, 'innerWidth === 320 && document.querySelector(".widget[data-theme=liquid][data-ink=dark] .assignment") !== null'), '液态玻璃小窗口或重载状态未恢复');
          assert.equal(await act(window, 'window.clock.setup().then(value => value.settings.liveBackdrop)'), true);
          await pause(450);
          assert.equal(captures, 0, '液态玻璃静止、移动、缩放、刷新、重载都不应调用桌面取样');
          assert.equal(await act(window, '!!document.querySelector(".desktop-backdrop, .desktop-tint, .liquid-material canvas")'), false);
          await act(window, `(() => {
            document.querySelector('.home-view').style.visibility = 'hidden';
            return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          })()`);
          const image = await window.capturePage();
          await act(window, 'document.querySelector(".home-view").style.visibility = ""');
          const { width, height } = image.getSize();
          const pixels = image.toBitmap();
          const alpha = (x, y) => pixels[(Math.floor(y) * width + Math.floor(x)) * 4 + 3];
          assert.ok([0.25, 0.5, 0.75].every(x => alpha(width * x, height * 0.5) === 0), '液态玻璃中央应完全透明');
          assert.ok(alpha(width * 0.22, height * 0.018) > 0, '窗口边缘应保留固定高光');
          assert.equal(await act(window, '[...document.querySelectorAll(".countdown")].every(el => el.scrollWidth <= el.clientWidth)'), true);
          await act(window, 'Promise.all([window.clock.change("liveBackdrop", false), window.clock.change("ink", "light"), window.clock.change("blur", 0)])');
          window.setBounds(bounds);
          window.reload();
          await waitFor(() => act(window, 'document.querySelector(".widget[data-theme=liquid][data-ink=light] .assignment") !== null'), '测试外观未恢复');
          await click('组件设置');
        } finally { desktopCapturer.getSources = getSources; }
        console.log('Liquid glass QA passed: transparent center, static edge highlights, no desktop capture under motion or refresh.');
      }
      if (process.env.HOMEWORK_CLOCK_QA_WALLPAPER) {
        await backing.loadURL('data:text/html,' + encodeURIComponent(`<style>
          body{margin:0;background:#355c77;overflow:hidden}
          div{position:absolute;inset:0;width:150%;background:repeating-linear-gradient(115deg,#315d79 0 36px,#c8a47e 36px 72px);animation:wallpaper 3s linear infinite alternate}
          @keyframes wallpaper{to{transform:translateX(-144px)}}
          </style><div></div>`));
        await act(window, `window.wallpaperFrames = new Set();
          window.clock.onBackdrop(frame => { if (frame?.image) window.wallpaperFrames.add(frame.image); });
          [...document.querySelectorAll('.theme-options button')].find(button => button.textContent === '经典磨砂').click()`);
        await waitFor(() => act(window, 'window.wallpaperFrames.size === 1 && document.querySelector(".classic-material .desktop-backdrop")?.naturalWidth'), '经典磨砂未接入桌面背景');
        const backdropSettings = await act(window, 'window.clock.setup().then(value => value.settings)');
        assert.deepEqual([backdropSettings.classicBlur, backdropSettings.classicOpacity, backdropSettings.liveBackdrop, backdropSettings.blur], [20, 68, false, 0]);
        await pause(430);
        assert.equal(await act(window, 'window.wallpaperFrames.size'), 1, '静态模式不应随壁纸刷新');

        await act(window, '[...document.querySelectorAll("label")].find(node => node.textContent.includes("跟随动态壁纸")).querySelector("input").click()');
        const originalPosition = window.getPosition();
        await waitFor(() => act(window, 'window.wallpaperFrames.size >= 5'), '静止窗口未跟随动态壁纸变化');
        assert.deepEqual(window.getPosition(), originalPosition);
        window.hide();
        await waitFor(() => act(window, '!document.querySelector(".classic-material .desktop-backdrop")'), '隐藏后桌面背景未释放');
        const hiddenCount = await act(window, 'window.wallpaperFrames.size');
        await pause(450);
        assert.equal(await act(window, 'window.wallpaperFrames.size'), hiddenCount, '隐藏时应暂停采样');
        window.showInactive();
        window.moveTop();
        await waitFor(async () => await act(window, 'window.wallpaperFrames.size') > hiddenCount, '重新显示后没有恢复动态壁纸');
        assert.equal(await act(window, 'document.querySelector("input[aria-label=背景模糊]").max'), '32');
        await changeRange('背景模糊', 25);
        await changeRange('底色微雾', 55);
        await waitFor(() => act(window, '(() => { const image = document.querySelector(".classic-material .desktop-backdrop"); return image && getComputedStyle(image).filter.startsWith("blur(25px)"); })()'), '经典磨砂未应用模糊设置');
        assert.equal(await act(window, 'getComputedStyle(document.querySelector(".classic-material .desktop-tint")).opacity'), '0.55');
        assert.match(await act(window, 'getComputedStyle(document.querySelector(".classic-material"), "::after").backgroundImage'), /^url\(/);
        await click('返回');
        await waitFor(() => act(window, '!!document.querySelector(".assignment")'), '经典磨砂时间线未恢复');
        assert.equal(await act(window, 'getComputedStyle(document.querySelector(".assignment")).filter'), 'none');
        await backing.loadURL('data:text/html,' + encodeURIComponent(`<style>body{background:
          radial-gradient(ellipse at 94% 4%,#8ebcff 0 25%, transparent 26%),
          radial-gradient(ellipse at 23% 97%,#f3ad88 0 29%,transparent 30%),
          linear-gradient(137deg,#707bd2 10%, #698cbe 38%, #8dbea9 39%, #8dc2c4 78%, #a39cdd 79%); height:100vh;margin:0}</style>`));
        await pause(380);
        await screenshot('classic-frost');
        window.reload();
        await waitFor(() => act(window, 'document.querySelector(".widget[data-theme=classic] .desktop-backdrop")?.naturalWidth'), '重载后经典磨砂取样未恢复');
        const persisted = await act(window, 'window.clock.setup().then(value => value.settings)');
        assert.deepEqual([persisted.theme, persisted.classicBlur, persisted.classicOpacity, persisted.liveBackdrop], ['classic', 25, 55, true]);
        await act(window, 'window.clock.change("liveBackdrop", false)');
        await click('组件设置');
        console.log('Dynamic wallpaper QA passed: animated desktop frames while stationary, paused when hidden, resumed and restored settings.');
      }

      if (process.env.HOMEWORK_CLOCK_QA_INK) {
        const testWallpaper = `radial-gradient(ellipse at 86% 76%,#111c35 0 28%,transparent 54%),
          radial-gradient(ellipse at 9% 11%,#f4f8fb 0 25%,transparent 53%),
          radial-gradient(ellipse at 27% 80%,#a38fcb 0 17%,transparent 53%),
          repeating-linear-gradient(127deg,#f6d7ae 0 35px,#305774 35px 70px)`;
        await backing.loadURL('data:text/html,' + encodeURIComponent(`<style>body{margin:0;height:100vh;background:${testWallpaper}}</style>`));

        window.moveTop();

        for (const [theme, label] of [['liquid', '液态玻璃'], ['classic', '经典磨砂']]) {
          for (const [ink, name] of [['dark', '深墨'], ['light', '浅字']]) {
            await act(window, `[...document.querySelectorAll('.theme-options button')].find(button => button.textContent === '${label}').click()`);
            await waitFor(() => act(window, `document.querySelector('.widget').dataset.theme === '${theme}'`), '玻璃主题未应用');
            await act(window, `[...document.querySelectorAll('.segmented button')].find(button => button.textContent === '${name}').click()`);
            await click('返回');
            await waitFor(() => act(window, `document.querySelector('.widget').dataset.ink === '${ink}' && !!document.querySelector('.assignment')`), '文字模式未应用');
            if (theme === 'classic') await waitFor(() => act(window, '!!document.querySelector(".desktop-backdrop")?.naturalWidth'), '经典磨砂背景未加载');
            const typography = await act(window, `[...document.querySelectorAll('.assignment strong, .course, .countdown')].map(el => {
              const css = getComputedStyle(el);
              return [css.color, css.webkitTextStrokeWidth, css.fontSize];
            })`);
            assert.ok(typography.length >= 9);
            for (const [color, strokeWidth, fontSize] of typography) {
              assert.match(color, /^rgb\(/, '玻璃主题文字应使用实色');
              assert.ok(parseFloat(strokeWidth) <= 0.5, '不应再对细字体使用厚描边');
              assert.ok(parseFloat(fontSize) >= 12);
            }
            const wallpaperStyle = theme === 'liquid'
              ? await window.webContents.insertCSS(`.native-stage { background: ${testWallpaper}; }`)
              : null;
            try { await screenshot(`${theme}-${ink}-ink`); }
            finally { if (wallpaperStyle) await window.webContents.removeInsertedCSS(wallpaperStyle); }
            await click('组件设置');
          }
        }
        await act(window, 'window.clock.change("ink", "dark")');
        window.setBounds({ ...bounds, width: 320, height: 320 });
        window.reload();
        await waitFor(() => act(window, 'innerWidth === 320 && document.querySelector(".widget[data-theme=classic][data-ink=light] .assignment") !== null'), '经典磨砂浅字未随重载保留');
        assert.equal(await act(window, 'window.clock.setup().then(value => value.settings.ink)'), 'dark');
        assert.equal(await act(window, '[...document.querySelectorAll(".countdown")].every(el => el.scrollWidth <= el.clientWidth)'), true);
        await act(window, 'Promise.all([window.clock.change("ink", "light"), window.clock.change("classicInk", "dark")])');
        window.setBounds(bounds);
        window.reload();
        await waitFor(() => act(window, 'document.querySelector(".widget[data-theme=classic][data-ink=dark] .assignment") !== null'), '测试外观未恢复');
        await click('组件设置');
        console.log('Glass ink QA passed: 4 variants with opaque text and no heavy stroke, 320 px and persisted independent ink.');
      }
    } finally {
      backing.destroy();
      window.setAlwaysOnTop(false);
    }
    for (const [index, theme] of [[1, 'mica'], [2, 'mist'], [3, 'cotton']]) {
      await act(window, 'document.querySelectorAll(".theme-options button")[' + index + '].click()');
      await waitFor(() => act(window, 'document.querySelector(".widget").dataset.theme === ' + JSON.stringify(theme)), '主题未应用');
      await click('返回');
      await act(window, 'document.activeElement.blur()');
      await screenshot(theme);
      await click('组件设置');
      await waitFor(() => act(window, 'Boolean(document.querySelector(".settings"))'), '设置未重新打开');
    }
    await act(window, 'document.querySelectorAll(".theme-options button")[0].click()');
    await click('返回');
    await click('置顶组件');
    await waitFor(async () => {
      const pinned = await act(window, 'window.clock.setup().then(value => value.settings.pinned)');
      return pinned && window.isAlwaysOnTop();
    }, '置顶没有生效');
    await click('取消置顶');
    await waitFor(() => !window.isAlwaysOnTop(), '取消置顶没有生效');
    await click('刷新作业');
    await waitFor(() => act(window, 'document.querySelector(".toast-notice")?.textContent.includes("已完成同步")'), '示例刷新未完成');
    window.reload();
    await waitFor(() => act(window, 'document.querySelector(".desktop-tint")?.style.opacity === "0.24"'), '滑块设置在重新加载后丢失');
    await act(window, 'Promise.all([window.clock.change("opacity", 0), window.clock.change("blur", 0), window.clock.change("pinned", false)])');
  } else {
    await waitFor(() => act(window, 'document.querySelector(".empty h3")?.textContent === "连接学习通"'), '真实未登录同步未显示登录入口');
    await screenshot('login');
    await act(window, 'document.querySelector(".primary").click()');
    await waitFor(() => BrowserWindow.getAllWindows().some(win => win !== window &&
      win.webContents.getURL().startsWith('https://passport2.chaoxing.com/')), '没有打开官方登录页');
    const official = BrowserWindow.getAllWindows().find(win => win !== window);
    assert.equal(official.webContents.getLastWebPreferences().nodeIntegration, false);
    console.log('Live QA passed: real unauthenticated sync and official login window.');
  }
}

module.exports = { verify };
