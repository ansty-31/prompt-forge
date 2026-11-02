const $ = (id) => document.getElementById(id);

const els = {
  picks: $('picks'),
  picksNote: $('picksNote'),
  req: $('req'),
  notes: $('notes'),
  go: $('go'),
  stop: $('stop'),
  cards: $('cards'),
  empty: $('empty'),
  count: $('count'),
  copyAll: $('copyAll'),
  status: $('status'),
  scrim: $('scrim'),
  drawer: $('drawer'),
  baseUrl: $('baseUrl'),
  model: $('model'),
  apiKey: $('apiKey'),
  envHint: $('envHint'),
};

const LS_KEY = 'pf.settings.v2';
const LS_TARGETS = 'pf.targets.v2';

const state = {
  targets: [],
  selected: new Set(['claude']),
  busy: false,
  runs: [],          // [{ id, ctrl, raw, ok }]
  settings: { baseUrl: '', model: 'deepseek-chat', apiKey: '' },
  health: null,
};

/* ================= 设置 ================= */
function loadSettings() {
  try {
    Object.assign(state.settings, JSON.parse(localStorage.getItem(LS_KEY) || '{}'));
    const saved = JSON.parse(localStorage.getItem(LS_TARGETS) || 'null');
    if (Array.isArray(saved) && saved.length) state.selected = new Set(saved);
  } catch { /* 忽略损坏数据 */ }
  els.baseUrl.value = state.settings.baseUrl || '';
  els.model.value = state.settings.model || 'deepseek-chat';
  els.apiKey.value = state.settings.apiKey || '';
}

function saveSettings() {
  state.settings = {
    baseUrl: els.baseUrl.value.trim(),
    model: els.model.value.trim() || 'deepseek-chat',
    apiKey: els.apiKey.value.trim(),
  };
  localStorage.setItem(LS_KEY, JSON.stringify(state.settings));
  closeDrawer();
  toast('已保存设置');
}

function openDrawer() { els.scrim.hidden = false; els.drawer.hidden = false; }
function closeDrawer() { els.scrim.hidden = true; els.drawer.hidden = true; }

/* ================= 顶栏状态 ================= */
let toastTimer = 0;
function toast(msg) {
  els.status.textContent = msg;
  els.status.className = 'status ok';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (!state.health) return;
    els.status.textContent = state.health.mock ? 'MOCK 模式' : '就绪';
    els.status.className = 'status ' + (state.health.mock ? 'bad' : 'ok');
  }, 2400);
}

/* ================= 目标选择 ================= */
function renderPicks() {
  els.picks.innerHTML = '';
  for (const t of state.targets) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick';
    b.dataset.id = t.id;
    b.style.setProperty('--c', t.accent || '#5eead4');
    b.setAttribute('aria-pressed', String(state.selected.has(t.id)));
    b.innerHTML = `<b>${t.label} · ${t.sub || ''}</b><small>${t.tagline || t.hint || ''}</small>`;
    b.title = t.hint || '';
    b.addEventListener('click', () => toggleTarget(t.id));
    els.picks.appendChild(b);
  }
  syncPicks();
}

function toggleTarget(id) {
  if (state.selected.has(id)) {
    if (state.selected.size === 1) return toast('至少选一个目标');
    state.selected.delete(id);
  } else {
    state.selected.add(id);
  }
  localStorage.setItem(LS_TARGETS, JSON.stringify([...state.selected]));
  syncPicks();
}

function syncPicks() {
  for (const b of els.picks.children) {
    b.setAttribute('aria-pressed', String(state.selected.has(b.dataset.id)));
  }
  els.picksNote.textContent = state.selected.size > 1
    ? `已选 ${state.selected.size} 个 · 并行出 ${state.selected.size} 份`
    : '可多选 · 并行出多份';
}

/* ================= 卡片 ================= */
function clearCards() {
  els.cards.innerHTML = '';
  state.runs = [];
  els.count.textContent = '';
  els.copyAll.disabled = true;
}

function makeCard(t) {
  const root = document.createElement('div');
  root.className = 'card';
  root.style.setProperty('--c', t.accent || '#5eead4');

  const head = document.createElement('div');
  head.className = 'card-head';
  head.innerHTML = `
    <span class="name">${t.label}</span>
    <span class="tag">${t.sub || ''}</span>
    <span class="meta">
      <span class="chars">生成中…</span>
      <button class="ghost copy-one" disabled>复制</button>
    </span>`;
  root.appendChild(head);

  const body = document.createElement('div');
  body.className = 'card-body';
  const pre = document.createElement('pre');
  pre.innerHTML = '<div class="skeleton" style="width:78%"></div><div class="skeleton" style="width:92%"></div><div class="skeleton" style="width:64%"></div>';
  body.appendChild(pre);
  root.appendChild(body);

  const chars = head.querySelector('.chars');
  const btn = head.querySelector('.copy-one');

  els.cards.appendChild(root);
  return { root, body, pre, chars, btn };
}

function paint(ui, raw, streaming) {
  ui.pre.textContent = raw;
  if (streaming) {
    const c = document.createElement('span');
    c.className = 'caret';
    ui.pre.append(c);
  }
}

/* ================= 生成 ================= */
function setBusy(on) {
  state.busy = on;
  els.go.disabled = on;
  els.go.textContent = on ? '生成中…' : '生成提示词';
  els.stop.hidden = !on;
}

async function runOne(t, requirement, notes) {
  const ui = makeCard(t);
  const run = { id: t.id, ctrl: new AbortController(), raw: '', ok: false, label: t.label };
  state.runs.push(run);

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: run.ctrl.signal,
      body: JSON.stringify({ target: t.id, requirement, notes, config: state.settings }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let failed = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }

        if (evt.type === 'delta') {
          const stick = ui.body.scrollHeight - ui.body.scrollTop - ui.body.clientHeight < 40;
          run.raw += evt.text;
          paint(ui, run.raw, true);
          ui.chars.textContent = `${run.raw.length} 字`;
          if (stick) ui.body.scrollTop = ui.body.scrollHeight;
        } else if (evt.type === 'error') {
          failed = true;
          ui.root.classList.add('err');
          ui.pre.textContent = `✖ ${evt.error}`;
          ui.chars.textContent = '失败';
        } else if (evt.type === 'done' && !failed) {
          paint(ui, run.raw, false);
          ui.chars.textContent = `${run.raw.length} 字 · 完成`;
        }
      }
    }

    if (!failed && run.raw) {
      run.ok = true;
      ui.btn.disabled = false;
      ui.btn.onclick = () => copyText(stripFence(run.raw), ui.btn);
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      if (run.raw) { run.ok = true; ui.btn.disabled = false; ui.btn.onclick = () => copyText(stripFence(run.raw), ui.btn); }
      paint(ui, run.raw + '\n\n[已停止]', false);
      ui.chars.textContent = '已停止';
    } else {
      ui.root.classList.add('err');
      ui.pre.textContent = `✖ ${e.message}`;
      ui.chars.textContent = '失败';
    }
  } finally {
    els.copyAll.disabled = !state.runs.some((r) => r.ok);
    els.count.textContent = `${state.runs.filter((r) => r.ok).length}/${state.runs.length} 完成`;
  }
}

async function generate() {
  if (state.busy) return;
  const requirement = els.req.value.trim();
  if (!requirement) {
    els.status.textContent = '先写需求';
    els.status.className = 'status bad';
    els.req.focus();
    return;
  }

  els.empty.hidden = true;
  clearCards();
  setBusy(true);

  const picked = state.targets.filter((t) => state.selected.has(t.id));
  await Promise.allSettled(picked.map((t) => runOne(t, requirement, els.notes.value)));

  setBusy(false);
}

/* ================= 复制 ================= */
function stripFence(text) {
  const m = text.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```/);
  return (m ? m[1] : text).trim();
}

async function copyText(payload, btn) {
  if (!payload) return;
  try {
    await navigator.clipboard.writeText(payload);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = payload;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  if (btn) {
    const old = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(() => (btn.textContent = old), 1400);
  }
}

function copyAll() {
  const parts = state.runs
    .filter((r) => r.ok)
    .map((r) => `===== ${r.label} =====\n${stripFence(r.raw)}`);
  if (!parts.length) return;
  copyText(parts.join('\n\n'), els.copyAll);
}

/* ================= 启动 ================= */
async function boot() {
  loadSettings();

  try {
    const res = await fetch('/api/health');
    state.health = await res.json();
    state.targets = state.health.targets || [];

    // 保存过的选择里过滤掉已不存在的 target
    state.selected = new Set([...state.selected].filter((id) => state.targets.some((t) => t.id === id)));
    if (!state.selected.size) state.selected.add('claude');

    renderPicks();
    els.req.placeholder = state.targets.find((t) => t.id === 'claude')?.placeholder || '';

    els.status.textContent = state.health.mock ? 'MOCK 模式' : '就绪';
    els.status.className = 'status ' + (state.health.mock ? 'bad' : 'ok');

    els.envHint.textContent = state.health.hasEnvKey
      ? '服务器已检测到环境变量里的 Key，此处可留空。'
      : `未检测到服务器环境变量 Key。当前模型：${state.settings.model || 'deepseek-chat'}`;
  } catch (e) {
    els.status.textContent = '服务未连接';
    els.status.className = 'status bad';
    els.empty.hidden = false;
    els.empty.innerHTML = `<p class="empty-title">连不上后端</p><p class="empty-sub">${e.message}<br>确认 <code>node server.mjs</code> 正在运行。</p>`;
  }
}

els.go.addEventListener('click', generate);
els.stop.addEventListener('click', () => state.runs.forEach((r) => r.ctrl?.abort()));
els.copyAll.addEventListener('click', copyAll);
$('openSettings').addEventListener('click', openDrawer);
$('closeSettings').addEventListener('click', closeDrawer);
$('save').addEventListener('click', saveSettings);
els.scrim.addEventListener('click', closeDrawer);
els.req.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') generate();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
});

boot();
