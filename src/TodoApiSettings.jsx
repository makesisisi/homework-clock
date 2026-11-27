import React, { useEffect, useState } from 'react';

export function TodoApiSettings({ bridge }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    bridge.todoApiStatus().then(value => { if (active) setStatus(value); })
      .catch(() => { if (active) setError('无法读取接口状态'); });
    return () => { active = false; };
  }, [bridge]);

  async function configure(enabled) {
    setBusy(true);
    setNotice('');
    setError('');
    try { setStatus(await bridge.configureTodoApi(enabled)); }
    catch { setError('无法更改接口状态'); }
    finally { setBusy(false); }
  }

  async function copy() {
    setNotice('');
    setError('');
    try {
      const result = await bridge.copyTodoApi();
      if (result.error) setError(result.error);
      else setNotice('已复制接口地址、路径与密钥');
    } catch { setError('无法复制调用配置'); }
  }

  return <fieldset className="todo-api-options">
    <legend>AI 接口</legend>
    <label className="snap-toggle"><span>允许本机工具新增待办、倒计时及读取数据</span>
      <input type="checkbox" checked={status?.enabled ?? false} disabled={!status || busy}
        onChange={event => void configure(event.target.checked)} />
    </label>
    {status?.enabled && <p className="timetable-hint"><code>{status.baseUrl}</code></p>}
    {status?.enabled && <div className="timetable-controls">
      <button type="button" className="text-button" disabled={busy} onClick={() => void copy()}>复制调用配置</button>
      {notice && <small role="status">{notice}</small>}
    </div>}
    {(error || status?.error) && <p className="timetable-warning" role="alert">{error || status.error}</p>}
  </fieldset>;
}
