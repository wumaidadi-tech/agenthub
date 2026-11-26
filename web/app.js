const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SECTIONS = { memory: '记忆', skills: '技能', session: '会话', mcp: '集成' };

let state = null;
let sel = null;
let view = 'canvas';
let memSel = null;
let memQ = '';
let skillQ = '';
let mcpQ = '';
let sessSel = null;
let sessQ = '';
let sessFrom = '';
let sessTo = '';
let sessProject = '';
let sessAll = false;
let sessCache = {};
let ovCache = null;
let importItems = null;

async function ensureImportItems() {
  if (importItems) return importItems;
  try {
    importItems = (await api('/api/import/candidates')).items;
  } catch {
    importItems = [];
  }
  return importItems;
}

/* ---------------- theme ---------------- */

function applyTheme() {
  const qp = new URLSearchParams(location.search);
  const qTheme = qp.get('theme');
  const qAccent = qp.get('accent');
  if (qTheme) localStorage.setItem('agenthub.theme', qTheme);
  if (qAccent) localStorage.setItem('agenthub.accent', qAccent);
  // 参数只在首次进入时生效，之后从 URL 摘掉，避免在设置里换色又被地址栏覆盖
  if (qTheme || qAccent) {
    qp.delete('theme');
    qp.delete('accent');
    const qs = qp.toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
  }
  const accent = localStorage.getItem('agenthub.accent') || 'lime';
  const theme = localStorage.getItem('agenthub.theme') || 'auto';
  document.documentElement.dataset.accent = accent;
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
applyTheme();

/* ---------------- utils ---------------- */

async function api(path, { method = 'GET', body } = {}) {
  const write = method !== 'GET';
  const res = await fetch(path, {
    method,
    headers: write ? { 'content-type': 'application/json' } : undefined,
    body: write ? JSON.stringify(body ?? {}) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

function iconHTML(a, size) {
  const title = esc(a.name);
  const style = size ? ` style="width:${size}px;height:${size}px"` : '';
  if (a.icon.kind === 'mask') {
    return `<span class="ava"${style} title="${title}"><span class="mark"${size ? ` style="width:${Math.round(size * 0.66)}px;height:${Math.round(size * 0.66)}px;background-color:${esc(a.color)};-webkit-mask-image:url('/icons/${a.icon.file}');mask-image:url('/icons/${a.icon.file}')"` : ` style="background-color:${esc(a.color)};-webkit-mask-image:url('/icons/${a.icon.file}');mask-image:url('/icons/${a.icon.file}')"`}></span></span>`;
  }
  if (a.icon.kind === 'img') {
    return `<span class="ava"${style} title="${title}"><img src="/icons/${a.icon.file}" alt="${title}"></span>`;
  }
  return `<span class="ava text"${style} title="${title}">${esc(a.name.slice(0, 1))}</span>`;
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

function firstLine(text, max = 80) {
  const line = String(text || '').split(/\r?\n/).find((s) => s.trim()) || '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

function fmtDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function download(name, text) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function identicon(name) {
  const h = hashStr(name);
  const cells = [];
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      if ((h >>> ((y * 3 + x) % 29)) & 1) {
        cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
        if (x < 2) cells.push(`<rect x="${4 - x}" y="${y}" width="1" height="1"/>`);
      }
    }
  }
  return `<svg viewBox="0 0 5 5" shape-rendering="crispEdges" aria-hidden="true">${cells.join('')}</svg>`;
}

function coverageMatrix(mems) {
  const agents = writableAgents();
  if (!agents.length) return '';
  const rows = mems.slice(0, 24);
  return `<div class="cmatrix" style="--cm-cols:${agents.length}">
    <div class="cmatrix-head"><span class="cm-corner">记忆 × agent</span>${agents
      .map((a) => `<span class="cm-col">${iconHTML(a)}</span>`)
      .join('')}</div>
    ${rows
      .map(
        (m) => `<div class="cmatrix-row">
          <span class="cm-name" title="${esc(m.title)}">${esc(m.title)}</span>
          ${agents
            .map(
              (a) =>
                `<i class="cnode ${m.targets.includes(a.id) ? 'on' : ''}" title="${esc(a.name)}${
                  m.targets.includes(a.id) ? ' · 已分发' : ' · 未分发'
                }"></i>`,
            )
            .join('')}
        </div>`,
      )
      .join('')}
  </div>`;
}

function heatmapHTML(items) {
  const counts = {};
  for (const s of items) {
    const d = String(s.updatedAt).slice(0, 10);
    counts[d] = (counts[d] || 0) + 1;
  }
  const max = Math.max(1, ...Object.values(counts));
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 83);
  start.setDate(start.getDate() - start.getDay());
  const cells = [];
  for (let i = 0; i < 84; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const n = counts[key] || 0;
    const lvl = n === 0 ? 0 : n >= max * 0.66 ? 3 : n >= max * 0.33 ? 2 : 1;
    cells.push(`<i class="hm-cell l${lvl}" title="${key} · ${n} 段"></i>`);
  }
  return `<div class="heatmap-wrap">
    <div class="heatmap">${cells.join('')}</div>
    <div class="hm-legend"><span>近 12 周</span><i class="hm-cell l0"></i><i class="hm-cell l1"></i><i class="hm-cell l2"></i><i class="hm-cell l3"></i><span>多</span></div>
  </div>`;
}

function mcpRing(enabled, total) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const pct = total ? enabled / total : 0;
  return `<svg class="mcp-ring" viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="${r}" class="ring-bg"/>
    <circle cx="24" cy="24" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(
      c * (1 - pct)
    ).toFixed(1)}" transform="rotate(-90 24 24)"/>
    <text x="24" y="28" text-anchor="middle">${enabled}</text>
  </svg>`;
}

function currentAgent() {
  return state.agents.find((a) => a.id === sel) || null;
}

function agentName(id) {
  return state.agents.find((a) => a.id === id)?.name || id;
}

function writableAgents() {
  return state.agents.filter((a) => a.installed && a.caps.memory === 'rw' && a.sync !== false);
}

function targetedMemories() {
  return state.memories.filter((m) => m.targets.includes(sel));
}

// 记忆页展示整个中心库，未分发给当前 agent 的条目会标注
function agentMemories() {
  return [...state.memories].sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === 'global' ? -1 : 1;
    return a.updated < b.updated ? 1 : -1;
  });
}

// 用于覆盖率小点的 agent：有读写记忆能力的最多 4 家
function memoryAgents() {
  return state.agents.filter((a) => a.caps.memory === 'rw' && a.installed).slice(0, 4);
}

function dotColor(a) {
  return !a.color || a.color === 'currentColor' ? 'var(--ink-2)' : a.color;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function agentSkills() {
  return state.skills.items.filter((s) => s.byAgent[sel]);
}

function agentMcp() {
  return state.mcp.items.filter((i) => i.byAgent[sel]);
}

/* ---------------- shell ---------------- */

async function load() {
  state = await api('/api/state');
  const params = new URLSearchParams(location.search);
  const wantAgent = params.get('agent');
  const wantView = params.get('view');
  if (wantView && (wantView === 'canvas' || SECTIONS[wantView])) view = wantView;
  if (wantAgent && state.agents.some((a) => a.id === wantAgent)) sel = wantAgent;
  if (!sel || !state.agents.some((a) => a.id === sel)) {
    sel = (state.agents.find((a) => a.installed) || state.agents[0]).id;
  }
  render();
  loadOverview();
  if (location.hash === '#settings') openDrawer();
  if (location.hash === '#mcp-import') openMcpImport();
  if (location.hash === '#import') openImportDialog();
}

async function loadOverview() {
  try {
    ovCache = await api('/api/overview');
    if (view === 'canvas') updateCounts();
  } catch {
    /* ignore */
  }
}

function syncUrl() {
  const u = new URL(location.href);
  u.searchParams.set('agent', sel);
  u.searchParams.set('view', view);
  history.replaceState(null, '', u);
}

function render() {
  syncUrl();
  renderRail();
  renderWho();
  renderMain();
}

function renderRail() {
  $('#rail').innerHTML = state.agents
    .map(
      (a) => `<button class="rail-agent ${a.id === sel ? 'on' : ''} ${a.installed ? '' : 'off'}" type="button" data-agent="${
        a.id
      }" title="${esc(a.name)}">${iconHTML(a)}</button>`,
    )
    .join('');
}

function renderWho() {
  const a = currentAgent();
  if (!a) {
    $('#who').innerHTML = '';
    return;
  }
  $('#who').innerHTML = `
    ${iconHTML(a)}
    <div class="who-text">
      <b>${esc(a.name)}</b>
      <span class="who-path">${esc(a.memoryPath || '无可写本地记忆文件')}</span>
    </div>
    ${a.installed ? '' : '<span class="tag gray">未安装</span>'}
    ${a.sync === false ? '<span class="tag warn">未参与</span>' : ''}`;
}

function renderMain() {
  const canvas = $('#canvas-wrap');
  const main = $('#view-main');
  const back = $('#btn-back');
  if (!canvas || !main) return;

  if (view === 'canvas') {
    canvas.hidden = false;
    main.hidden = true;
    back.hidden = true;
    renderCanvas();
    return;
  }

  canvas.hidden = true;
  main.hidden = false;
  back.hidden = false;
  renderSection();
}

function renderCanvas() {
  const a = currentAgent();
  const center = $('#node-center');
  if (!a) {
    center.innerHTML = '<span class="n-sub">NO AGENT</span>';
    return;
  }
  const ov = ovCache?.rows?.find((r) => r.id === a.id);
  center.innerHTML = `
    ${iconHTML(a, 76)}
    <span class="center-name">${esc(a.name)}</span>
    <span class="center-sub">${a.installed ? (a.sync === false ? '未参与管理' : '已连接') : '未安装'}</span>`;

  updateCounts();
  if (ov?.lastActive) {
    const el = $('#c-session');
    if (el) el.title = `最近活动 ${fmtDate(ov.lastActive)}`;
  }
}

function updateCounts() {
  const ov = ovCache?.rows?.find((r) => r.id === sel);
  const set = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };
  set('#c-memory', ov ? ov.memories : agentMemories().length);
  set('#c-skills', ov ? ov.skills : agentSkills().length);
  set('#c-mcp', ov ? ov.mcp : agentMcp().length);
  set('#c-session', sessCache[sel]?.total ?? ov?.sessions ?? '·');
}

function openSection(sec) {
  view = sec;
  render();
}

function closeSection() {
  view = 'canvas';
  render();
}

/* ---------------- memory ---------------- */

function coverageHTML(items) {
  const list = memoryAgents();
  if (!list.length) return '';
  const total = items.length;
  return `<div class="coverage">
    <div class="coverage-head">
      <span class="coverage-title">分发覆盖</span>
      <span class="coverage-note">当前 ${total} 条记忆，同时写给了哪几家</span>
    </div>
    <div class="cover-grid">
      ${list
        .map((a) => {
          const n = items.filter((m) => m.targets.includes(a.id)).length;
          const pct = total ? Math.round((n / total) * 100) : 0;
          return `<div class="cover-cell ${a.id === sel ? 'is-cur' : ''} ${a.installed ? '' : 'is-off'}">
            <span class="cover-id">
              ${iconHTML(a, 18)}
              <span class="cover-name">${esc(a.name)}</span>
              ${a.id === sel ? '<span class="cover-cur">当前</span>' : ''}
            </span>
            <span class="cover-val"><b>${n}</b><span>/${total}</span></span>
            <span class="cover-bar" title="${pct}%"><i style="width:${pct}%"></i></span>
          </div>`;
        })
        .join('')}
    </div>
  </div>`;
}

function memGroupHead(scope, arr) {
  const n = arr.filter((m) => m.scope === scope).length;
  return `<div class="group-head">
    <span class="group-title">${scope === 'global' ? '全局' : '项目'}</span>
    <span class="group-note">${scope === 'global' ? '所有项目共用' : '只在当前项目里生效'}</span>
    <span class="group-rule"></span>
    <span class="group-count">${n} 条</span>
  </div>`;
}

function memoryRow(m, i = 0, arr = [m]) {
  const prev = i > 0 ? arr[i - 1] : null;
  const head = !prev || prev.scope !== m.scope ? memGroupHead(m.scope, arr) : '';
  const list = memoryAgents();
  const n = list.filter((a) => m.targets.includes(a.id)).length;
  const dots = list
    .map((a) => {
      const on = m.targets.includes(a.id);
      const label = `${a.name}${on ? ' 已分发' : ' 未分发'}`;
      return `<i class="cov-dot ${on ? 'on' : ''}" style="--dot:${dotColor(a)}" title="${esc(label)}" aria-label="${esc(label)}"></i>`;
    })
    .join('');
  return `${head}<button class="row mem-card ${m.id === memSel ? 'is-on' : ''}" type="button" data-mid="${esc(m.id)}">
    <span class="mem-body">
      <span class="mem-top">
        <span class="mem-title">${esc(m.title)}</span>
        <span class="tag ${m.scope === 'global' ? 'blue' : ''}">${m.scope === 'global' ? '全局' : '项目'}</span>
        ${m.targets.includes(sel) ? '' : '<span class="tag warn">未分发</span>'}
      </span>
      <span class="mem-sum">${esc(firstLine(m.body, 96)) || '还没有内容'}</span>
    </span>
    <span class="mem-side">
      <span class="cov-dots" aria-label="已分发 ${n}/${list.length} 家">${dots}</span>
      <span class="mem-n">${n}/${list.length}</span>
    </span>
  </button>`;
}

function memFiltered() {
  return agentMemories().filter((m) => {
    if (!memQ) return true;
    const q = memQ.toLowerCase();
    return m.title.toLowerCase().includes(q) || m.body.toLowerCase().includes(q);
  });
}

function memListHTML(items) {
  if (items.length) return items.map(memoryRow).join('');
  if (!state.memories.length) {
    return `<div class="empty empty-block">
      <svg class="empty-art" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.3"><ellipse cx="20" cy="12" rx="12" ry="4.6"/><path d="M8 12v8c0 2.5 5.4 4.6 12 4.6s12-2.1 12-4.6v-8"/><path d="M8 20v8c0 2.5 5.4 4.6 12 4.6s12-2.1 12-4.6v-8"/></svg>
      <b>中心库还没有记忆</b>
      <p>建一条试试，或者从各 agent 的已有记忆里导入。</p>
      <button class="btn" type="button" data-act="new-memory">＋ 新建记忆</button>
    </div>`;
  }
  return `<div class="empty empty-block">
    <b>没有匹配的记忆</b>
    <p>换个关键词，或者清空搜索。</p>
  </div>`;
}

function renderMemory() {
  const all = agentMemories();
  const items = memFiltered();
  if (!items.some((m) => m.id === memSel)) memSel = items[0]?.id || null;

  if (!all.length && !memQ) {
    $('#content').innerHTML = `
      <div class="view-head">
        <div>
          <h1>记忆</h1>
          <p class="sub">这里是 AgentHub 自己的记忆库，写一次，再决定发给哪几家。</p>
        </div>
        <div class="head-actions">
          <button class="btn primary" type="button" data-act="new-memory">＋ 新建记忆</button>
          <button class="btn" type="button" data-act="import">从 agent 导入</button>
        </div>
      </div>
      <div class="mem-empty" id="mem-empty">
        <svg class="empty-art" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.3"><ellipse cx="24" cy="12" rx="14" ry="5.5"/><path d="M10 12v9c0 3 6.3 5.5 14 5.5s14-2.5 14-5.5v-9"/><path d="M10 21v9c0 3 6.3 5.5 14 5.5s14-2.5 14-5.5v-9"/><path d="M10 30v6c0 3 6.3 5.5 14 5.5s14-2.5 14-5.5v-6"/></svg>
        <b>中心库还是空的</b>
        <p>各 agent 自己的记忆还留在它们各自的目录里，没有自动搬过来。可以一次导入，也可以从零开始写。</p>
        <div class="mem-empty-hint" id="mem-empty-hint">正在检查各家已有的记忆…</div>
      </div>`;
    ensureImportItems().then((list) => {
      const el = $('#mem-empty-hint');
      if (!el) return;
      el.innerHTML = list.length
        ? `检测到各 agent 里已有 <b>${list.length}</b> 条记忆。<button class="btn primary" type="button" data-act="import">一次导入</button>`
        : '暂时没有可导入的记忆，先新建一条。';
    });
    return;
  }

  $('#content').innerHTML = `
    <div class="view-head">
      <div>
        <h1>记忆</h1>
        <p class="sub">整个记忆库。小点表示分发给了谁；标「未分发」的还没发给 ${esc(currentAgent().name)}。</p>
      </div>
      <div class="head-actions">
        <button class="btn primary" type="button" data-act="new-memory">＋ 新建记忆</button>
        <button class="btn" type="button" data-act="import">从 agent 导入</button>
      </div>
    </div>
    ${all.length ? coverageMatrix(all) : ''}
    <div class="toolbar">
      <div class="search-big">
        <span class="s-ico"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4 13.6 13.6"/></svg></span>
        <input id="mem-q" type="search" placeholder="搜索标题或内容…" value="${esc(memQ)}" autocomplete="off">
      </div>
      <span class="tool-count">共 ${items.length} 条</span>
    </div>
    <div class="cols ${items.length ? '' : 'no-sel'}">
      <div class="mem-list" id="mem-list">${memListHTML(items)}</div>
      <div class="pane raise" id="mem-detail"></div>
    </div>`;

  renderMemDetail();
}

function targetsHTML(memory) {
  return state.agents
    .map((a) => {
      const rw = a.caps.memory === 'rw';
      const usable = rw && a.installed && a.sync !== false;
      const on = memory ? memory.targets.includes(a.id) : usable && (a.id === sel || a.defaultTarget !== false);
      const stateText = !rw ? '只读' : !a.installed ? '未安装' : on ? '已选择' : '未选';
      const stateCls = !rw ? 'ro' : on ? 'on' : '';
      return `<label class="target ${usable ? '' : 'is-muted'}">
        <input type="checkbox" data-agent="${a.id}" ${on && usable ? 'checked' : ''} ${usable ? '' : 'disabled'}>
        ${iconHTML(a)}
        <span class="target-main">
          <span class="target-name">${esc(a.name)}</span>
          <span class="target-path">${esc(a.memoryPath || '无可写本地文件，仅支持复制文本')}</span>
        </span>
        <span class="target-state ${stateCls}">${stateText}</span>
      </label>`;
    })
    .join('');
}

function renderMemDetail() {
  const pane = $('#mem-detail');
  if (!pane) return;
  const mem = state.memories.find((m) => m.id === memSel);
  if (!mem) {
    pane.innerHTML = '<div class="empty">选左边一条记忆</div>';
    return;
  }
  const n = writableAgents().length;
  const picked = mem.targets.filter((id) => writableAgents().some((a) => a.id === id)).length;
  pane.innerHTML = `
    <div class="pane-head">
      <span class="kicker">记忆详情</span>
      <span class="pane-state ${picked ? 'on' : ''}">已选 ${picked} 家</span>
    </div>
    <input class="detail-title" id="d-title" maxlength="60" value="${esc(mem.title)}" aria-label="记忆标题">
    <textarea class="detail-body" id="d-body" rows="4" aria-label="记忆内容">${esc(mem.body)}</textarea>
    <div class="split"></div>
    <div class="sec-label">作用域</div>
    <div class="pillgroup scope-pill">
      <button type="button" class="chip ${mem.scope === 'global' ? 'on' : ''}" data-scope="global">全局</button>
      <button type="button" class="chip ${mem.scope === 'project' ? 'on' : ''}" data-scope="project">项目</button>
    </div>
    <div class="split"></div>
    <div class="sec-label">分发给 <span class="sec-note">勾上就一起写入</span></div>
    <div id="d-targets">${targetsHTML(mem)}</div>
    <div class="actions">
      <button class="btn primary" type="button" data-act="sync">同步到 ${n} 个 agent</button>
      <button class="btn" type="button" data-act="save">只保存</button>
      <button class="btn danger" type="button" data-act="del">删除</button>
    </div>
    <div class="hint">写入前自动备份；只替换标记块，不碰你手写的内容。</div>`;
}

function checkedTargets(root) {
  return $$('input[data-agent]', root)
    .filter((i) => i.checked && !i.disabled)
    .map((i) => i.dataset.agent);
}

/* ---------------- skills ---------------- */

let skillSel = null;
let skillFilter = 'all';
const skillDocCache = {};

function skillTile(s) {
  const on = s.name === skillSel;
  const installed = state.agents.filter((a) => s.byAgent[a.id]);
  const here = s.byAgent[sel] || null;
  const hereOn = !!here;
  return `<button class="skill-card ${on ? 'is-on' : ''} ${hereOn ? 'is-here' : ''}" type="button" data-skill="${esc(s.name)}">
    <span class="skill-glyph ${s.inLibrary ? 'in-lib' : ''}" aria-hidden="true">${identicon(s.name)}</span>
    <span class="skill-body">
      <span class="skill-name">${esc(s.name)}</span>
      <span class="skill-desc">${esc(s.description || 'SKILL.md 没有写 description')}</span>
    </span>
    <span class="skill-foot">
      <span class="skill-agents">${installed.map((a) => iconHTML(a)).join('') || '<i class="skill-none">无</i>'}</span>
      <span class="skill-state ${s.inLibrary ? 'in' : ''}">${s.inLibrary ? '中心库' : '未收库'}</span>
    </span>
  </button>`;
}

function renderSkills() {
  const all = state.skills.items;
  const q = skillQ.toLowerCase();
  const items = all.filter((s) => !q || s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q));
  const shown = items.filter((s) => skillFilter === 'all' || (skillFilter === 'in' ? s.inLibrary : !s.inLibrary));
  if (!shown.some((s) => s.name === skillSel)) skillSel = shown[0]?.name || null;

  $('#content').innerHTML = `
    <div class="view-head">
      <div>
        <h1>技能</h1>
        <p class="sub">全站技能一览。点一个看 SKILL.md、决定装到哪几家；收进中心库后一份内容可分发给多家。</p>
      </div>
      <div class="head-actions">
        <button class="btn primary" type="button" data-act="import-skill">＋ 从文件夹导入</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="search-big">
        <span class="s-ico"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4 13.6 13.6"/></svg></span>
        <input id="skill-q" type="search" placeholder="搜索技能名或描述…" value="${esc(skillQ)}" autocomplete="off">
      </div>
      <button class="chip ${skillFilter === 'all' ? 'on' : ''}" type="button" data-skill-filter="all">全部 ${all.length}</button>
      <button class="chip ${skillFilter === 'in' ? 'on' : ''}" type="button" data-skill-filter="in">中心库 ${all.filter((s) => s.inLibrary).length}</button>
      <button class="chip ${skillFilter === 'out' ? 'on' : ''}" type="button" data-skill-filter="out">未收库 ${all.filter((s) => !s.inLibrary).length}</button>
      <span class="tool-count">显示 ${shown.length}</span>
    </div>
    <div class="cols">
      <div class="skill-grid" id="skill-list">${
        shown.map(skillTile).join('') ||
        `<div class="empty empty-block span-all">
          <svg class="empty-art" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
            <path d="M20 5.5 34 12.5 20 19.5 6 12.5 20 5.5Z"/><path d="M6 20.5 20 27.5l14-7"/><path d="M6 27.5 20 34.5l14-7"/>
          </svg>
          <b>${all.length ? '没有匹配的技能' : '还没发现任何技能'}</b>
          <p>${all.length ? '换个关键词或切换筛选。' : '技能按目录装在各个 agent 下；也可以用「从文件夹导入」把下载好的技能收进中心库。'}</p>
        </div>`
      }</div>
      <div class="pane raise" id="skill-detail"></div>
    </div>`;

  renderSkillDetail();
}

function renderSkillDetail() {
  const pane = $('#skill-detail');
  if (!pane) return;
  const s = state.skills.items.find((x) => x.name === skillSel);
  if (!s) {
    pane.innerHTML = '<div class="empty">选左侧一个技能</div>';
    return;
  }
  const doc = skillDocCache[skillSel];
  const agents = state.agents.filter((a) => a.skillsPath && a.installed);
  const rows = agents
    .map((a) => {
      const cur = s.byAgent[a.id] || null;
      const label = cur === 'link' ? '已指向' : cur === 'copy' ? '已复制' : cur === 'external' ? '已有目录' : '未安装';
      const cls = cur === 'link' || cur === 'copy' ? 'on' : cur === 'external' ? 'ro' : '';
      const chip = (mode, text) => {
        const off = cur === 'external' && mode !== 'link';
        return `<button type="button" class="chip ${cur === mode ? 'on' : ''}" data-agent="${a.id}" data-mode="${mode}" ${
          off ? 'disabled' : ''
        }>${text}</button>`;
      };
      return `<div class="skill-target">
        ${iconHTML(a)}
        <span class="skill-target-name">${esc(a.name)}</span>
        <span class="target-state ${cls}">${label}</span>
        <span class="pillgroup">${chip('none', '不装')}${chip('copy', '复制')}${chip('link', '指向')}</span>
      </div>`;
    })
    .join('');

  pane.innerHTML = `
    <div class="pane-head">
      <span class="kicker">技能详情</span>
      <span class="pane-state ${s.inLibrary ? 'on' : ''}">${s.inLibrary ? '中心库' : '未收库'}</span>
    </div>
    <div class="skill-detail-title">${esc(s.name)}</div>
    <p class="skill-detail-desc">${esc(s.description || 'SKILL.md 没有写 description')}</p>
    ${
      s.inLibrary
        ? `<div class="split"></div><div class="sec-label">装到哪几家</div><div class="skill-targets">${rows}</div>`
        : `<div class="split"></div><div class="lib-note"><span>还没收进中心库。收进来之后才能给各家复制或指向。</span><button class="btn primary" type="button" data-act="skill-lib">收进中心库</button></div>`
    }
    <div class="split"></div>
    <div class="sec-label">SKILL.md</div>
    <pre class="skill-doc" id="skill-doc">${doc ? esc(doc.text.slice(0, 8000)) : '读取中…'}</pre>`;
  if (!doc) loadSkillDoc(skillSel);
}

async function loadSkillDoc(name) {
  if (skillDocCache[name]) return;
  try {
    skillDocCache[name] = await api(`/api/skills/${encodeURIComponent(name)}/doc`);
  } catch (err) {
    skillDocCache[name] = { text: `读取失败：${err.message}` };
  }
  if (skillSel === name) renderSkillDetail();
}

function selectSkill(name) {
  skillSel = name;
  $$('#skill-list .skill-card').forEach((c) => c.classList.toggle('is-on', c.dataset.skill === name));
  renderSkillDetail();
}

/* ---------------- sessions ---------------- */

async function ensureSessions(force = false) {
  const key = sessAll ? '__all' : sel;
  if (sessCache[key] && !force) return sessCache[key];
  const p = new URLSearchParams({ agent: sessAll ? '' : sel, limit: sessAll ? '500' : '200' });
  if (sessQ) p.set('q', sessQ);
  const res = await api(`/api/sessions?${p.toString()}`);
  sessCache[key] = { total: res.total, items: res.items };
  updateCounts();
  return sessCache[key];
}

function sessDay(iso) {
  const d = new Date(iso);
  const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (diff <= 0) return { key: 'today', label: '今天', time: hm };
  if (diff === 1) return { key: 'yesterday', label: '昨天', time: hm };
  return { key: 'older', label: '更早', time: `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` };
}

function sessionMatches(s) {
  if (sessProject && s.project !== sessProject) return false;
  const day = String(s.updatedAt).slice(0, 10);
  if (sessFrom && day < sessFrom) return false;
  if (sessTo && day > sessTo) return false;
  return true;
}

function renderSessions() {
  const cache = sessCache[sessAll ? '__all' : sel];
  const list = cache ? cache.items.filter(sessionMatches) : [];
  const projects = cache ? [...new Set(cache.items.map((s) => s.project).filter(Boolean))].sort() : [];
  const projLabel = (p) => {
    const parts = p.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || p;
  };
  const labelCount = {};
  projects.forEach((p) => {
    const l = projLabel(p);
    labelCount[l] = (labelCount[l] || 0) + 1;
  });
  const projOptions = projects.map((p) => {
    const l = projLabel(p);
    const parent = p.split(/[\\/]/).filter(Boolean).slice(-2, -1)[0] || '';
    const label = labelCount[l] > 1 && parent ? `${parent}/${l}` : l;
    return { value: p, label };
  });
  $('#content').innerHTML = `
    <div class="view-head">
      <div>
        <h1>会话</h1>
        <p class="sub">${esc(currentAgent().name)} 的历史对话。选一段看转录，或者生成交接摘要带到别家。</p>
      </div>
    </div>
    ${cache ? `<div class="hm-block">${heatmapHTML(cache.items)}</div>` : ''}
    <div class="toolbar">
      <div class="search-big">
        <span class="s-ico"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4 13.6 13.6"/></svg></span>
        <input id="sess-q" type="search" placeholder="搜索会话内容、文件名、报错…" value="${esc(sessQ)}" autocomplete="off">
      </div>
      <div class="seg two" role="group" aria-label="范围">
        <button class="chip ${sessAll ? '' : 'on'}" type="button" data-sessmode="agent">${esc(currentAgent().name)}</button>
        <button class="chip ${sessAll ? 'on' : ''}" type="button" data-sessmode="all">全部 agent</button>
      </div>
      <label class="filter"><span>从</span><input id="sess-from" type="date" value="${esc(sessFrom)}"></label>
      <label class="filter"><span>到</span><input id="sess-to" type="date" value="${esc(sessTo)}"></label>
      <label class="filter"><span>工作区</span>
        <select id="sess-project" title="${esc(sessProject || '全部工作区')}">
          <option value="">全部工作区</option>
          ${projOptions
            .map(
              (o) =>
                `<option value="${esc(o.value)}" title="${esc(o.value)}" ${
                  o.value === sessProject ? 'selected' : ''
                }>${esc(o.label)}</option>`,
            )
            .join('')}
        </select>
      </label>
      <span class="tool-count">${cache ? `${list.length} / ${cache.total} 段` : '读取中…'}</span>
    </div>
    <div class="cols">
      <div class="timeline" id="sess-list">${
        cache
          ? list.map(sessionRow).join('') || '<div class="empty empty-block">没有符合条件的会话</div>'
          : '<div class="empty">正在扫会话文件…</div>'
      }</div>
      <div class="pane raise" id="sess-detail">
        <div class="pane-head">
          <span class="kicker">会话详情</span>
          ${cache ? `<span class="pane-state">${cache.total} 段</span>` : ''}
        </div>
        <div class="empty pane-empty">
          <svg class="empty-art" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M6 9.5h28v18H19l-8 6v-6H6z"/><path d="M12 16h16M12 21h10"/></svg>
          <b>选一段会话</b>
          <p>左边按日期排好了，点一条看转录。</p>
          <div class="sess-sum">
            <span><b>${cache ? cache.total : '·'}</b> 段会话</span>
            <span><b>${cache?.items?.[0] ? fmtDate(cache.items[0].updatedAt) : '—'}</b> 最近一次</span>
          </div>
        </div>
      </div>
    </div>`;

  if (!cache) {
    ensureSessions().then(() => {
      if (view === 'session') renderSessions();
    });
  } else if (sessSel && list.some((s) => s.id === sessSel.id && s.agent === sessSel.agent)) {
    openSession(sessSel.id, sessSel.agent);
  }
}

function sessionRow(s, i = 0, arr = [s]) {
  const day = sessDay(s.updatedAt);
  const prev = i > 0 ? sessDay(arr[i - 1].updatedAt) : null;
  const head =
    !prev || prev.key !== day.key
      ? `<div class="tl-group">
          <span class="tl-head">${day.label}</span>
          <span class="tl-count">${arr.filter((x) => sessDay(x.updatedAt).key === day.key).length}</span>
          <span class="tl-rule"></span>
        </div>`
      : '';
  const on = sessSel && sessSel.id === s.id && (!sessAll || sessSel.agent === s.agent);
  const agentTag = sessAll ? `<span class="sess-agent">${esc(agentName(s.agent))}</span>` : '';
  return `${head}<button class="row sess-item ${on ? 'is-on' : ''}" type="button" data-sid="${esc(s.id)}" data-sagent="${esc(s.agent)}">
    <span class="sess-time">${day.time}</span>
    <span class="sess-rail"><i class="sess-dot"></i></span>
    <span class="sess-main">
      <span class="sess-title">${esc(s.title || '未命名会话')}</span>
      <span class="sess-meta">${agentTag}${s.count ? `${s.count} 条消息` : '无消息'}${
        s.project ? ` · <span class="sess-proj">${esc(s.project)}</span>` : ''
      }</span>
    </span>
  </button>`;
}

async function openSession(id, agent = sel) {
  sessSel = { id, agent };
  $$('#sess-list .row').forEach((r) => r.classList.toggle('is-on', r.dataset.sid === id && r.dataset.sagent === agent));
  const cols = $('#sess-detail')?.closest('.cols');
  if (cols) cols.classList.remove('no-sel');
  $('#sess-detail').innerHTML = '<div class="empty">加载中…</div>';
  try {
    const s = await api(`/api/sessions/${agent}/${id}`);
    renderSessionDetail(s);
  } catch (err) {
    $('#sess-detail').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

function renderSessionDetail(s) {
  const msgs = s.messages || [];
  const disabled = !s.searchable || !msgs.length;
  const cmd = s.agent === 'claude' ? `claude --resume ${s.id}` : s.agent === 'codex' ? `codex resume ${s.id}` : '';
  $('#sess-detail').innerHTML = `
    <div class="pane-head">
      <span class="kicker">会话详情</span>
      <span class="pane-state">${s.searchable ? `${msgs.length} 条可读` : '仅元数据'}</span>
    </div>
    <div class="detail-h"><div class="detail-title">${esc(s.title)}</div></div>
    <div class="sess-facts">
      <span class="fact">${new Date(s.updatedAt).toLocaleString('zh-CN')}</span>
      ${sessAll ? `<span class="fact">${esc(agentName(s.agent))}</span>` : ''}
      ${s.count ? `<span class="fact">${s.count} 条消息</span>` : ''}
      ${s.project ? `<span class="fact mono" title="${esc(s.project)}">${esc(s.project)}</span>` : ''}
    </div>
    ${s.note ? `<div class="placeholder" style="padding:14px"><span>${esc(s.note)}</span></div>` : ''}
    ${
      s.project
        ? `<div class="cmdrow"><code>${esc(s.project)}</code><button class="btn" type="button" data-act="open-path" data-path="${esc(
            s.project,
          )}">打开文件夹</button></div>`
        : ''
    }
    ${
      cmd
        ? `<div class="cmdrow"><code>${esc(cmd)}</code><button class="btn" type="button" data-act="copy-cmd" data-copy="${esc(
            cmd,
          )}">复制命令</button></div>`
        : ''
    }
    <div class="transcript-box">
      ${
        msgs
          .map(
            (m) => `<div class="msg ${m.role === 'user' ? 'is-user' : m.role === 'tool' ? 'is-tool' : ''}"><span class="msg-role">${
              m.role === 'user' ? '用户' : m.role === 'tool' ? '工具' : '助手'
            }</span><span class="msg-text">${esc(m.text.slice(0, 3000))}</span></div>`,
          )
          .join('') || '<div class="empty">暂无消息</div>'
      }
    </div>
    <div class="actions">
      <button class="btn primary" type="button" data-act="handoff" ${disabled ? 'disabled' : ''}>生成交接摘要</button>
      <button class="btn" type="button" data-act="export" ${disabled ? 'disabled' : ''}>导出 .md</button>
    </div>
    <div class="hint">交接摘要按规则拼出来：首条需求 + 几条用户消息 + 最后一条结论 + 路径，不调用模型。</div>`;
}

/* ---------------- mcp ---------------- */

function mcpCard(item, writable) {
  const cell = item.byAgent[sel];
  const on = !!cell?.enabled;
  const transport = item.transport === 'stdio' ? '本地' : '远程';
  return `<div class="mcp-card ${on ? 'on' : 'off'}">
    <span class="mcp-bar" aria-hidden="true"></span>
    <span class="mcp-main">
      <span class="mcp-name">${esc(item.name)}</span>
      <span class="mcp-sum">${esc(item.summary || '没有可显示的命令或地址')}</span>
    </span>
    <span class="mcp-transport">${transport}</span>
    <button class="mcp-btn ${on ? 'on' : ''}" type="button" data-name="${esc(item.name)}" data-enabled="${on}" aria-pressed="${on}" ${
      writable ? '' : 'disabled title="该 agent 的配置不是 JSON，暂不支持写入"'
    }><span class="tg" aria-hidden="true"><i></i></span><span class="mcp-btn-label">${on ? '已启用' : '已停用'}</span></button>
  </div>`;
}

function renderMcp() {
  const all = agentMcp();
  const items = all.filter((it) => {
    if (!mcpQ) return true;
    const q = mcpQ.toLowerCase();
    return it.name.toLowerCase().includes(q) || String(it.summary || '').toLowerCase().includes(q);
  });
  const agentInfo = state.mcp.agents.find((a) => a.id === sel);
  const writable = agentInfo ? agentInfo.writable : false;
  const enabled = all.filter((it) => it.byAgent[sel]?.enabled).length;
  const onItems = items.filter((it) => it.byAgent[sel]?.enabled);
  const offItems = items.filter((it) => !it.byAgent[sel]?.enabled);
  const group = (title, list, hint) =>
    list.length
      ? `<div class="mcp-group">
          <div class="group-head">
            <span class="group-title">${title}</span>
            <span class="group-note">${hint}</span>
            <span class="group-rule"></span>
            <span class="group-count">${list.length} 项</span>
          </div>
          ${list.map((it) => mcpCard(it, writable)).join('')}
        </div>`
      : '';

  $('#content').innerHTML = `
    <div class="view-head">
      <div>
        <h1>集成</h1>
        <p class="sub">${esc(currentAgent().name)} 接的 MCP 服务。开关会直接改它的配置文件，改前备份。</p>
      </div>
      <div class="head-actions">
        <button class="btn" type="button" data-act="import-mcp">从其它 agent 导入</button>
        <button class="btn primary" type="button" data-act="add-mcp">＋ 添加 MCP</button>
      </div>
    </div>
    <div class="mcp-stats">
      <span class="mstat is-ring">${mcpRing(enabled, all.length)}<span class="ring-cap">启用比例</span></span>
      <span class="mstat is-on"><i class="sdot" aria-hidden="true"></i><b>${enabled}</b><span>启用</span></span>
      <span class="mstat"><i class="sdot off" aria-hidden="true"></i><b>${all.length - enabled}</b><span>停用</span></span>
      <span class="mstat is-mode ${writable ? 'writable' : ''}"><b>${writable ? '可写' : '只读'}</b><span>${
        writable ? '可以直接开关，改前备份' : '配置文件不是 JSON，改不了'
      }</span></span>
    </div>
    <div class="toolbar">
      <div class="search-big">
        <span class="s-ico"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4 13.6 13.6"/></svg></span>
        <input id="mcp-q" type="search" placeholder="搜索 MCP 名称或地址…" value="${esc(mcpQ)}" autocomplete="off">
      </div>
      <span class="tool-count">显示 ${items.length} / ${all.length}</span>
    </div>
    <div class="mcp-list">${
      onItems.length || offItems.length
        ? `${group('已启用', onItems, '正在为这家 agent 提供服务')}${group('已停用', offItems, '保留配置，随时可以打开')}`
        : `<div class="empty empty-block">
            <svg class="empty-art" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M14 6v8M26 6v8"/><path d="M9 14h22v7a11 11 0 0 1-22 0z"/><path d="M20 32v4"/></svg>
            <b>${all.length ? '没有匹配的 MCP' : '这家还没有配置 MCP'}</b>
            <p>${all.length ? '换个关键词试试。' : '添加一个本地命令或远程地址，保存后就会写进它的配置。'}</p>
            ${all.length ? '' : '<button class="btn" type="button" data-act="add-mcp">＋ 添加 MCP</button>'}
          </div>`
    }</div>`;
}

function renderSection() {
  const a = currentAgent();
  if (!a) {
    $('#content').innerHTML = '<div class="empty">没有可管理的 agent。</div>';
    return;
  }
  if (!a.installed) {
    $('#content').innerHTML = `
      <div class="view-head"><div><h1>${esc(a.name)}</h1><p class="sub">没检测到这台机器上的安装目录。</p></div></div>
      <div class="placeholder">
        <b>预期位置</b>
        <span class="mono">${esc(a.memoryPath || '未知')}</span>
        <span>装好之后刷新页面就会自动出现。</span>
      </div>`;
    return;
  }
  if (view === 'memory') renderMemory();
  else if (view === 'skills') renderSkills();
  else if (view === 'session') renderSessions();
  else if (view === 'mcp') renderMcp();
}

/* ---------------- settings ---------------- */

function openDrawer() {
  renderPrefs();
  renderPaths();
  renderThemeState();
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
}

function closeDrawer() {
  $('#drawer').hidden = true;
  $('#scrim').hidden = true;
}

function renderThemeState() {
  const accent = localStorage.getItem('agenthub.accent') || 'lime';
  const theme = localStorage.getItem('agenthub.theme') || 'auto';
  $$('#swatches .sw').forEach((s) => s.classList.toggle('on', s.dataset.accent === accent));
  $$('#theme-opts .chip').forEach((c) => c.classList.toggle('on', c.dataset.theme === theme));
}

function renderPrefs() {
  $('#pref-list').innerHTML = state.agents
    .map((a) => {
      const cap = !a.installed ? '未安装' : a.caps.memory === 'rw' ? '可读写记忆' : a.caps.memory === 'ro' ? '只读' : '不支持记忆';
      return `<div class="pref ${a.sync ? '' : 'is-paused'} ${a.installed ? '' : 'is-off'}">
        ${iconHTML(a)}
        <div class="pref-main">
          <span class="pref-line"><span class="pref-name">${esc(a.name)}</span><span class="pref-state">${cap}</span></span>
          <span class="pref-path">${esc(a.memoryPath || '无可写本地文件')}</span>
        </div>
        <button class="chip ${a.sync ? 'on' : ''}" type="button" data-pref="sync" data-id="${a.id}" ${
          a.installed ? '' : 'disabled'
        }>${a.installed ? (a.sync ? '已参与' : '未参与') : '不可用'}</button>
      </div>`;
    })
    .join('');
}

function renderPaths() {
  $('#paths').innerHTML = `
    <div class="path-row"><span class="k">数据目录</span><code>${esc(state.paths.data)}</code></div>
    <div class="path-row"><span class="k">备份目录</span><code>${esc(state.paths.backups)}</code></div>
    <p class="path-note">每次写入前会把原文件备份成 <span class="mono">backups/&lt;时间&gt;/&lt;agent&gt;/</span>。</p>`;
}

/* ---------------- dialogs ---------------- */

function openNewDialog(prefill) {
  const form = $('#new-form');
  form.reset();
  form.querySelector('[name="scope"]').value = 'global';
  if (prefill?.title) form.querySelector('[name="title"]').value = prefill.title;
  if (prefill?.body) form.querySelector('[name="body"]').value = prefill.body;
  $('#new-targets').innerHTML = targetsHTML(null);
  $('#dlg-new').showModal();
}

let skillName = null;

function openSkillDialog(name) {
  skillName = name;
  const item = state.skills.items.find((s) => s.name === name);
  if (!item) return;
  $('#sk-title').textContent = item.name;
  $('#sk-sub').textContent = item.inLibrary
    ? `中心库：~/.agenthub/skills/${item.name}`
    : '还没进中心库，先收进来才能统一分发。';
  $('#sk-import').hidden = item.inLibrary;
  $('#sk-agents').innerHTML = state.agents
    .filter((a) => a.skillsPath && a.installed)
    .map((a) => {
      const cur = item.byAgent[a.id] || null;
      const label =
        cur === 'link' ? '已指向' : cur === 'copy' ? '已复制' : cur === 'external' ? '已有同名目录' : '未安装';
      const cls = cur === 'link' || cur === 'copy' ? 'on' : cur === 'external' ? 'ro' : '';
      const canManage = item.inLibrary;
      const chip = (mode, text) => {
        const off = !canManage || (cur === 'external' && mode !== 'link');
        return `<button type="button" class="chip ${cur === mode ? 'on' : ''}" data-agent="${a.id}" data-mode="${mode}" ${
          off ? 'disabled' : ''
        }>${text}</button>`;
      };
      return `<div class="skill-target">
        ${iconHTML(a)}
        <span class="skill-target-name">${esc(a.name)}</span>
        <span class="target-state ${cls}">${label}</span>
        <span class="pillgroup">${chip('none', '不装')}${chip('copy', '复制')}${chip('link', '指向')}</span>
      </div>`;
    })
    .join('');
  $('#dlg-skill').showModal();
}

async function setSkillMode(agentId, mode) {
  try {
    const res = await api('/api/skills/apply', { method: 'POST', body: { name: skillSel, agentId, mode } });
    state = res.state;
    render();
    toast(mode === 'none' ? '已移除' : mode === 'copy' ? '已复制一份' : '已指向中心库');
  } catch (err) {
    toast(err.message);
  }
}

async function importSkillToLibrary() {
  const item = state.skills.items.find((s) => s.name === skillSel);
  const source = item?.agents[0];
  if (!source) return;
  try {
    const res = await api('/api/skills/import', { method: 'POST', body: { name: skillSel, agentId: source } });
    state = res.state;
    render();
    toast('已收进中心库');
  } catch (err) {
    toast(err.message);
  }
}

function openSkillPathDialog() {
  $('#skill-path-form').reset();
  $('#dlg-skill-path').showModal();
}

async function submitSkillPath(e) {
  e.preventDefault();
  const p = e.target.querySelector('[name="path"]').value.trim();
  try {
    const res = await api('/api/skills/import-path', { method: 'POST', body: { path: p } });
    state = res.state;
    skillSel = res.result.name;
    $('#dlg-skill-path').close();
    render();
    toast('已导入中心库');
  } catch (err) {
    toast(err.message);
  }
}

let importSrc = '';
let importAll = [];

function renderImportSources() {
  const counts = new Map();
  importAll.forEach((it) => counts.set(it.agent, (counts.get(it.agent) || 0) + 1));
  const agents = state.agents.filter((a) => counts.has(a.id));
  if (!agents.length) {
    $('#import-src').innerHTML = '<div class="empty">没有可导入的 agent</div>';
    return;
  }
  if (!agents.some((a) => a.id === importSrc)) importSrc = agents[0].id;
  $('#import-src').innerHTML = agents
    .map(
      (a) => `<button class="src-btn ${a.id === importSrc ? 'on' : ''}" type="button" data-src="${a.id}">
        ${iconHTML(a)}
        <span class="src-name">${esc(a.name)}</span>
        <span class="src-n">${counts.get(a.id)} 条</span>
      </button>`,
    )
    .join('');
}

function renderImportList() {
  const items = importAll.filter((it) => it.agent === importSrc);
  $('#import-list').innerHTML = items.length
    ? items
        .map(
          (it) => `<label class="import-item">
            <input type="checkbox" data-agent="${it.agent}" data-file="${esc(it.file)}" data-index="${it.index}" checked>
            <span style="min-width:0">
              <span class="import-title">${esc(it.title)}</span>
              <span class="import-preview">${esc(it.preview)}</span>
            </span>
          </label>`,
        )
        .join('')
    : '<div class="empty">这个 agent 没有可导入的记忆</div>';
  updateImportCount();
}

function updateImportCount() {
  const n = $$('#import-list input:checked').length;
  const el = $('#import-count');
  if (el) el.textContent = `${n} 条`;
}

async function openImportDialog() {
  try {
    const { items } = await api('/api/import/candidates');
    importAll = items;
    if (!items.length) return toast('没有可导入的记忆');
    renderImportSources();
    renderImportList();
    $('#dlg-import').showModal();
  } catch (err) {
    toast(err.message);
  }
}

async function doImport() {
  const picked = $$('#import-list input:checked').map((i) => ({
    agent: i.dataset.agent,
    file: i.dataset.file,
    index: Number(i.dataset.index),
  }));
  if (!picked.length) return toast('先勾几条');
  try {
    let next = null;
    for (const it of picked) {
      const res = await api('/api/import', { method: 'POST', body: it });
      next = res.state;
    }
    if (next) {
      state = next;
      importItems = null;
      render();
    }
    $('#dlg-import').close();
    toast(`导入了 ${picked.length} 条`);
  } catch (err) {
    toast(err.message);
  }
}

function updateMcpForm() {
  const http = $('#mcp-transport').value === 'http';
  $('#mcp-target-label').textContent = http ? 'URL' : '命令';
  $('#mcp-form').querySelector('[name="target"]').placeholder = http
    ? 'https://example.com/mcp'
    : 'npx -y @modelcontextprotocol/server-filesystem D:\\work';
}

let mcpImportSrc = '';

function renderMcpSources() {
  const sources = state.mcp.agents.filter(
    (a) => a.configured && a.writable && a.id !== sel && state.agents.find((x) => x.id === a.id)?.installed,
  );
  if (!sources.length) {
    $('#mcp-src').innerHTML = '<div class="empty">没有其它可读取的 agent</div>';
    return;
  }
  if (!sources.some((a) => a.id === mcpImportSrc)) mcpImportSrc = sources[0].id;
  $('#mcp-src').innerHTML = sources
    .map((a) => {
      const ag = state.agents.find((x) => x.id === a.id);
      return `<button class="src-btn ${a.id === mcpImportSrc ? 'on' : ''}" type="button" data-src="${a.id}">
        ${ag ? iconHTML(ag) : ''}
        <span class="src-name">${esc(ag?.name || a.id)}</span>
        <span class="src-n">${a.count} 项</span>
      </button>`;
    })
    .join('');
}

function renderMcpImportCount() {
  const n = $$('#mcp-import-list input:checked').length;
  const el = $('#mcp-import-count');
  if (el) el.textContent = `${n} 项`;
}

function openMcpImport() {
  const sources = state.mcp.agents.filter(
    (a) => a.configured && a.writable && a.id !== sel && state.agents.find((x) => x.id === a.id)?.installed,
  );
  if (!sources.length) return toast('没有其它可读取的 agent 配置');
  mcpImportSrc = sources[0].id;
  renderMcpSources();
  renderMcpImportList();
  $('#dlg-mcp-import').showModal();
}

function renderMcpImportList() {
  const have = new Set(agentMcp().map((i) => i.name));
  const items = state.mcp.items.filter((i) => i.byAgent[mcpImportSrc] && !have.has(i.name));
  $('#mcp-import-list').innerHTML = items.length
    ? items
        .map(
          (it) => `<label class="import-item">
            <input type="checkbox" value="${esc(it.name)}" checked>
            <span style="min-width:0">
              <span class="import-name">${esc(it.name)}</span>
              <span class="import-preview">${esc(it.summary || '')}</span>
            </span>
          </label>`,
        )
        .join('')
    : '<div class="empty">这个 agent 的 MCP 这边都已经有了</div>';
  renderMcpImportCount();
}

async function doMcpImport() {
  const names = $$('#mcp-import-list input:checked').map((i) => i.value);
  if (!names.length) return toast('先勾几项');
  try {
    const res = await api('/api/mcp/import', {
      method: 'POST',
      body: { fromAgent: mcpImportSrc, toAgent: sel, names },
    });
    state = res.state;
    render();
    $('#dlg-mcp-import').close();
    toast(
      `导入 ${res.result.added.length} 项${res.result.skipped.length ? `，跳过 ${res.result.skipped.length} 项` : ''}`,
    );
  } catch (err) {
    toast(err.message);
  }
}

function openMcpDialog() {
  const form = $('#mcp-form');
  form.reset();
  const eligible = state.mcp.agents.filter(
    (a) => a.configured && a.writable && state.agents.some((x) => x.id === a.id && x.installed),
  );
  if (!eligible.length) return toast('没有可写入的 MCP 配置（需要已安装且配置是 JSON）');
  $('#mcp-agent').innerHTML = eligible
    .map((a) => `<option value="${a.id}">${esc(state.agents.find((x) => x.id === a.id)?.name || a.id)}</option>`)
    .join('');
  if (eligible.some((a) => a.id === sel)) $('#mcp-agent').value = sel;
  updateMcpForm();
  $('#dlg-mcp').showModal();
}

async function submitMcp(e) {
  e.preventDefault();
  const form = e.target;
  const agentId = form.querySelector('[name="agent"]').value;
  const name = form.querySelector('[name="name"]').value.trim();
  const transport = form.querySelector('[name="transport"]').value;
  const target = form.querySelector('[name="target"]').value.trim();
  if (!name || !target) return toast('名称和命令/URL 都要填');
  const body = { agentId, name };
  if (transport === 'http') {
    body.url = target;
  } else {
    const [command, ...args] = target.split(/\s+/);
    body.command = command;
    body.args = args;
  }
  try {
    const res = await api('/api/mcp/add', { method: 'POST', body });
    state = res.state;
    render();
    $('#dlg-mcp').close();
    toast('已添加并启用');
  } catch (err) {
    toast(err.message);
  }
}

async function saveMemory({ sync }) {
  const mem = state.memories.find((m) => m.id === memSel);
  if (!mem) return;
  const payload = {
    title: $('#d-title').value,
    body: $('#d-body').value,
    scope: $('#mem-detail .scope-pill .chip.on')?.dataset.scope || mem.scope,
    targets: (() => {
      const visible = checkedTargets($('#d-targets'));
      const hidden = mem.targets.filter(
        (id) => !state.agents.some((a) => a.id === id && a.installed && a.caps.memory === 'rw' && a.sync !== false),
      );
      return [...new Set([...visible, ...hidden])];
    })(),
  };
  try {
    state = await api(`/api/memories/${mem.id}`, { method: 'PUT', body: payload });
    if (sync) {
      const agents = writableAgents();
      const res = await api('/api/sync', { method: 'POST', body: { agentIds: agents.map((a) => a.id) } });
      state = res.state;
      const written = res.results.filter((r) => !r.skipped && !r.error);
      toast(written.length ? `已写入 ${written.map((r) => r.name || r.agent).join('、')}` : '没有写入任何 agent');
    } else {
      toast('已保存');
    }
    render();
  } catch (err) {
    toast(err.message);
  }
}

/* ---------------- events ---------------- */

$('#rail').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-agent]');
  if (!btn) return;
  sel = btn.dataset.agent;
  view = 'canvas';
  memSel = null;
  sessSel = null;
  memQ = '';
  skillQ = '';
  sessQ = '';
  sessFrom = '';
  sessTo = '';
  sessProject = '';
  sessAll = false;
  mcpQ = '';
  render();
});

$('#btn-back').addEventListener('click', closeSection);
$('#btn-settings').addEventListener('click', openDrawer);
$('#drawer-close').addEventListener('click', closeDrawer);
$('#scrim').addEventListener('click', closeDrawer);

$('#swatches').addEventListener('click', (e) => {
  const sw = e.target.closest('[data-accent]');
  if (!sw) return;
  localStorage.setItem('agenthub.accent', sw.dataset.accent);
  applyTheme();
  renderThemeState();
});

$('#theme-opts').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-theme]');
  if (!chip) return;
  localStorage.setItem('agenthub.theme', chip.dataset.theme);
  applyTheme();
  renderThemeState();
});

$('#pref-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-pref]');
  if (!btn || btn.disabled) return;
  const agent = state.agents.find((a) => a.id === btn.dataset.id);
  if (!agent) return;
  try {
    const res = await api('/api/settings', {
      method: 'POST',
      body: { agentId: agent.id, patch: { sync: !agent.sync } },
    });
    state = res.state;
    render();
    renderPrefs();
    toast(agent.sync ? '已关闭' : '已开启');
  } catch (err) {
    toast(err.message);
  }
});

$('#canvas-wrap').addEventListener('click', (e) => {
  const node = e.target.closest('[data-sec]');
  if (!node) return;
  openSection(node.dataset.sec);
});

$('#content').addEventListener('click', async (e) => {
  const t = e.target;

  if (t.closest('[data-act="new-memory"]')) return openNewDialog();
  if (t.closest('[data-act="import"]')) return openImportDialog();
  if (t.closest('[data-act="add-mcp"]')) return openMcpDialog();
  if (t.closest('[data-act="import-mcp"]')) return openMcpImport();

  const memRow = t.closest('[data-mid]');
  if (memRow) {
    memSel = memRow.dataset.mid;
    $$('#mem-list .row').forEach((r) => r.classList.toggle('is-on', r.dataset.mid === memSel));
    renderMemDetail();
    return;
  }

  const skillRow = t.closest('[data-skill]');
  if (skillRow) return selectSkill(skillRow.dataset.skill);

  const sfilter = t.closest('[data-skill-filter]');
  if (sfilter) {
    skillFilter = sfilter.dataset.skillFilter;
    renderSkills();
    return;
  }

  if (t.closest('[data-act="import-skill"]')) return openSkillPathDialog();
  if (t.closest('[data-act="skill-lib"]')) return importSkillToLibrary();

  const modeChip = t.closest('#skill-detail .chip[data-mode]');
  if (modeChip && !modeChip.disabled) return setSkillMode(modeChip.dataset.agent, modeChip.dataset.mode);

  const sessMode = t.closest('[data-sessmode]');
  if (sessMode) {
    const all = sessMode.dataset.sessmode === 'all';
    if (all === sessAll) return;
    sessAll = all;
    sessSel = null;
    sessProject = '';
    renderSessions();
    return;
  }

  const sessRow = t.closest('[data-sid]');
  if (sessRow) return openSession(sessRow.dataset.sid, sessRow.dataset.sagent || sel);

  if (t.closest('.chip[data-scope]')) {
    $$('.pillgroup .chip').forEach((c) => c.classList.remove('on'));
    t.closest('.chip').classList.add('on');
    return;
  }

  if (t.closest('[data-act="save"]')) return saveMemory({ sync: false });
  if (t.closest('[data-act="sync"]')) return saveMemory({ sync: true });

  if (t.closest('[data-act="del"]')) {
    const mem = state.memories.find((m) => m.id === memSel);
    if (!mem) return;
    if (!confirm(`删除「${mem.title}」？已写入各 agent 的内容要再同步一次才会清掉。`)) return;
    try {
      state = await api(`/api/memories/${mem.id}`, { method: 'DELETE' });
      memSel = null;
      render();
      toast('已删除，记得同步一次清理残留');
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  if (t.closest('[data-act="open-path"]')) {
    const p = t.closest('[data-act="open-path"]').dataset.path;
    try {
      await api('/api/open-path', { method: 'POST', body: { path: p } });
      toast('已在资源管理器打开');
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  if (t.closest('[data-act="copy-cmd"]')) {
    try {
      await navigator.clipboard.writeText(t.closest('[data-act="copy-cmd"]').dataset.copy || '');
      toast('已复制');
    } catch {
      toast('复制失败，请手动选中');
    }
    return;
  }

  const mcpBtn = t.closest('.mcp-btn');
  if (mcpBtn && !mcpBtn.disabled) {
    try {
      const res = await api('/api/mcp/toggle', {
        method: 'POST',
        body: { name: mcpBtn.dataset.name, agentId: sel, enabled: mcpBtn.dataset.enabled !== 'true' },
      });
      state = res.state;
      render();
      toast('已切换，原配置已备份');
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  if (!sessSel) return;
  const base = `/api/sessions/${sel}/${sessSel.id}`;
  if (t.closest('[data-act="handoff"]')) {
    try {
      const res = await api(`${base}/handoff`, { method: 'POST' });
      $('#handoff-text').value = res.markdown;
      $('#handoff-path').textContent = `已保存到：${res.path}`;
      $('#dlg-handoff').showModal();
    } catch (err) {
      toast(err.message);
    }
    return;
  }
  if (t.closest('[data-act="export"]')) {
    try {
      const res = await api(`${base}/export`, { method: 'POST' });
      download(`${res.title.replace(/[\\/:*?"<>|]/g, '-')}.md`, res.markdown);
      toast('已导出');
    } catch (err) {
      toast(err.message);
    }
    return;
  }
  if (t.closest('[data-act="draft"]')) {
    try {
      const res = await api(`${base}/draft`, { method: 'POST' });
      view = 'memory';
      render();
      openNewDialog({ title: res.title, body: res.body });
    } catch (err) {
      toast(err.message);
    }
  }
});

$('#content').addEventListener('change', (e) => {
  if (e.target.id === 'sess-from') {
    sessFrom = e.target.value;
    renderSessions();
    return;
  }
  if (e.target.id === 'sess-to') {
    sessTo = e.target.value;
    renderSessions();
    return;
  }
  if (e.target.id === 'sess-project') {
    sessProject = e.target.value;
    renderSessions();
    return;
  }
  const box = e.target.closest('input[data-agent]');
  if (!box) return;
  const line = box.closest('.target');
  const st = line?.querySelector('.target-state');
  if (st) {
    st.textContent = box.checked ? '已选择' : '未选';
    st.classList.toggle('on', box.checked);
  }
  // 勾选后即时反映到右侧计数和左侧卡片的小点
  const checked = new Set(
    $$('#d-targets input[data-agent]')
      .filter((i) => i.checked && !i.disabled)
      .map((i) => i.dataset.agent),
  );
  const paneState = $('#mem-detail .pane-state');
  if (paneState) {
    paneState.textContent = `已选 ${checked.size} 家`;
    paneState.classList.toggle('on', checked.size > 0);
  }
  const card = $('#mem-list .mem-card.is-on');
  if (card) {
    const list = memoryAgents();
    $$('.cov-dot', card).forEach((dot, i) => {
      const a = list[i];
      if (!a) return;
      dot.classList.toggle('on', checked.has(a.id));
      dot.title = `${a.name}${checked.has(a.id) ? ' 已分发' : ' 未分发'}`;
    });
    const n = list.filter((a) => checked.has(a.id)).length;
    const label = card.querySelector('.cov-dots');
    const num = card.querySelector('.mem-n');
    if (label) label.setAttribute('aria-label', `已分发 ${n}/${list.length} 家`);
    if (num) num.textContent = `${n}/${list.length}`;
  }
});

let inputTimer;
$('#content').addEventListener('input', (e) => {
  const id = e.target.id;
  if (!['mem-q', 'skill-q', 'sess-q', 'mcp-q'].includes(id)) return;
  const v = e.target.value.trim();
  clearTimeout(inputTimer);
  inputTimer = setTimeout(() => {
    if (id === 'mem-q') {
      memQ = v;
      const items = memFiltered();
      if (!items.some((m) => m.id === memSel)) memSel = items[0]?.id || null;
      const list = $('#mem-list');
      if (list) list.innerHTML = memListHTML(items);
      const count = $('.tool-count');
      if (count) count.textContent = `共 ${items.length} 条`;
      const cols = $('.cols');
      if (cols) cols.classList.toggle('no-sel', !items.length);
      renderMemDetail();
    }
    if (id === 'skill-q') {
      skillQ = v;
      renderSkills();
      const input = $('#skill-q');
      if (input) {
        input.value = skillQ;
        input.focus();
      }
    }
    if (id === 'sess-q') {
      sessQ = v;
      ensureSessions(true).then(() => {
        if (view === 'session') renderSessions();
        const input = $('#sess-q');
        if (input) input.value = sessQ;
      });
    }
    if (id === 'mcp-q') {
      mcpQ = v;
      renderMcp();
      const input = $('#mcp-q');
      if (input) {
        input.value = mcpQ;
        input.focus();
      }
    }
  }, 220);
});

$('#new-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = {
    title: form.querySelector('[name="title"]').value,
    body: form.querySelector('[name="body"]').value,
    scope: form.querySelector('[name="scope"]').value,
    targets: checkedTargets($('#new-targets')),
  };
  try {
    state = await api('/api/memories', { method: 'POST', body });
    $('#dlg-new').close();
    memSel = state.memories[0]?.id || null;
    render();
    toast('已创建');
  } catch (err) {
    toast(err.message);
  }
});
$('#new-cancel').addEventListener('click', () => $('#dlg-new').close());

$('#sk-close').addEventListener('click', () => $('#dlg-skill').close());
$('#sk-import').addEventListener('click', importSkillToLibrary);
$('#sk-agents').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip[data-mode]');
  if (!chip || chip.disabled) return;
  setSkillMode(chip.dataset.agent, chip.dataset.mode);
});

$('#handoff-close').addEventListener('click', () => $('#dlg-handoff').close());
$('#handoff-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#handoff-text').value);
    toast('已复制');
  } catch {
    toast('复制失败，请手动选中');
  }
});
$('#handoff-dl').addEventListener('click', () => download('handoff.md', $('#handoff-text').value));

$('#import-cancel').addEventListener('click', () => $('#dlg-import').close());
$('#import-do').addEventListener('click', doImport);
$('#import-src').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-src]');
  if (!btn) return;
  importSrc = btn.dataset.src;
  renderImportSources();
  renderImportList();
});
$('#import-list').addEventListener('change', updateImportCount);

$('#mcp-cancel').addEventListener('click', () => $('#dlg-mcp').close());
$('#mcp-transport').addEventListener('change', updateMcpForm);
$('#mcp-form').addEventListener('submit', submitMcp);
$('#mcp-import-cancel').addEventListener('click', () => $('#dlg-mcp-import').close());
$('#mcp-import-do').addEventListener('click', doMcpImport);
$('#mcp-src').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-src]');
  if (!btn) return;
  mcpImportSrc = btn.dataset.src;
  renderMcpSources();
  renderMcpImportList();
});
$('#mcp-import-list').addEventListener('change', renderMcpImportCount);
$('#skill-path-cancel').addEventListener('click', () => $('#dlg-skill-path').close());
$('#skill-path-form').addEventListener('submit', submitSkillPath);
$('#skill-path-pick').addEventListener('click', async () => {
  try {
    const res = await api('/api/pick-folder', { method: 'POST' });
    if (res.path) {
      $('#skill-path-form').querySelector('[name="path"]').value = res.path;
    }
  } catch (err) {
    toast(err.message);
  }
});

load().catch((err) => {
  document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif">加载失败：${esc(err.message)}</div>`;
});