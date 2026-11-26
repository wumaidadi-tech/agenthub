import fs from 'node:fs/promises';
import path from 'node:path';
import { HOME, DATA_DIR, writeFileAtomic } from './store.mjs';

const TEXT_CAP = 200 * 1024;
const HANDOFF_DIR = path.join(DATA_DIR, 'handoffs');
const cache = new Map();

function roots() {
  return {
    qoder: path.join(HOME, '.qoder-cn', 'projects'),
    claude: path.join(HOME, '.claude', 'projects'),
    codex: path.join(HOME, '.codex', 'sessions'),
  };
}

function workbuddyRoots() {
  return [
    path.join(HOME, '.workbuddy', 'projects'),
    path.join(HOME, '.workbuddy-ai', 'projects'),
  ];
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function walkJsonl(dir, maxDepth = 4, depth = 0) {
  if (depth > maxDepth) return [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'subagents' || e.name === 'node_modules') continue;
      out.push(...(await walkJsonl(full, maxDepth, depth + 1)));
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
  return out;
}

function blockText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const b of content) {
    if (!b) continue;
    if ((b.type === 'text' || b.type === 'input_text' || b.type === 'output_text') && b.text) {
      parts.push(b.text);
    } else if (b.type === 'tool_use') {
      const a = b.input && typeof b.input === 'object' ? b.input : {};
      const pick = a.file_path || a.path || a.command || a.pattern || a.query || '';
      const args = typeof pick === 'string' ? pick.replace(/\s+/g, ' ').slice(0, 180) : '';
      parts.push(`[调用工具] ${b.name || ''}${args ? ' ' + args : ''}`);
    }
  }
  return parts.join('\n');
}

function makeTitle(text) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  return line.length > 48 ? `${line.slice(0, 48)}…` : line || '未命名会话';
}

function isInjected(text) {
  const s = String(text || '').trim();
  if (s.length < 3) return true;
  return (
    s.startsWith('Base directory for this skill') ||
    s.startsWith('<system-reminder') ||
    s.startsWith('<') ||
    s.startsWith('Caveat:') ||
    s.startsWith('{"')
  );
}

function cleanupUsers(messages) {
  return messages.filter((m) => m.role === 'user' && !isInjected(m.text)).map((m) => m.text);
}

// WorkBuddy 把真实提问包在 <user_query> 里，其余是每轮注入的上下文
function workbuddyUserText(text) {
  const q = text.match(/<user_query>([\s\S]*?)<\/user_query>/);
  if (q) return q[1].trim();
  let s = text
    .replace(/<system-reminder[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<task-notification[\s\S]*?<\/task-notification>/g, '')
    .trim();
  if (!s) return '';
  if (s.startsWith('<cb_summary') || s.startsWith('Your task is to write a detailed')) return '';
  const meta = s.match(/^Sender \(untrusted metadata\):[\s\S]*?```\s*\n+([\s\S]*)$/);
  if (meta) s = meta[1].trim();
  return s;
}

async function parseMessages(agent, file) {
  const raw = await fs.readFile(file, 'utf8');
  const messages = [];
  let cwd = null;
  let lastTs = null;
  let title = null;

  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (agent === 'workbuddy') {
      if (o.type === 'ai-title') {
        cwd = o.cwd || cwd;
        if (o.aiTitle && !title) title = String(o.aiTitle);
        continue;
      }
      if (o.type === 'custom-title') {
        const t = o.customTitle || o.title;
        if (t) title = String(t);
        continue;
      }
      if (o.type === 'message') {
        let text = blockText(o.content).trim();
        if (o.role === 'user') text = workbuddyUserText(text);
        if (text) messages.push({ role: o.role || 'unknown', text, time: o.timestamp || null });
        if (o.timestamp) lastTs = o.timestamp;
        continue;
      }
      if (o.type === 'function_call') {
        const name = o.name || 'tool';
        let args = '';
        if (typeof o.arguments === 'string') {
          try {
            const a = JSON.parse(o.arguments);
            const pick = a.file_path || a.path || a.command || a.pattern || a.query || '';
            args = typeof pick === 'string' ? pick : '';
          } catch {
            args = o.arguments;
          }
        } else if (o.arguments && typeof o.arguments === 'object') {
          const pick = o.arguments.file_path || o.arguments.path || o.arguments.command || '';
          args = typeof pick === 'string' ? pick : '';
        }
        args = args.replace(/\s+/g, ' ').slice(0, 180);
        messages.push({ role: 'tool', text: `[调用工具] ${name}${args ? ' ' + args : ''}`, time: o.timestamp || null });
        if (o.timestamp) lastTs = o.timestamp;
        continue;
      }
      continue;
    }
    if (agent === 'codex') {
      if (o.type === 'session_meta') {
        cwd = o.payload?.cwd || cwd;
        lastTs = o.timestamp || lastTs;
        continue;
      }
      if (o.type === 'response_item' && o.payload?.type === 'message') {
        const text = blockText(o.payload.content).trim();
        if (text) {
          messages.push({ role: o.payload.role || 'unknown', text, time: o.timestamp || null });
          if (o.timestamp) lastTs = o.timestamp;
        }
        continue;
      }
      continue;
    }

    if (o.type === 'user' || o.type === 'assistant') {
      const text = blockText(o.message?.content).trim();
      if (text) {
        messages.push({ role: o.type, text, time: o.timestamp || null });
        if (o.timestamp) lastTs = o.timestamp;
      }
      continue;
    }
    if (o.type === 'workspace-directories' && Array.isArray(o.directories)) {
      cwd = o.directories[0] || cwd;
    }
  }

  return { messages, cwd, lastTs, title };
}

function toMeta(agent, file, parsed, stat) {
  const users = cleanupUsers(parsed.messages);
  const firstUser = users[0] || parsed.messages.find((m) => m.role === 'user')?.text || parsed.messages[0]?.text;
  let text = parsed.messages.map((m) => m.text).join('\n');
  if (text.length > TEXT_CAP) text = text.slice(0, TEXT_CAP);
  return {
    id: path.basename(file, '.jsonl'),
    agent,
    title: makeTitle(parsed.title || firstUser),
    updatedAt: parsed.lastTs || new Date(stat.mtimeMs).toISOString(),
    count: parsed.messages.length,
    text,
    file,
    searchable: true,
    project: parsed.cwd || path.basename(path.dirname(file)),
  };
}

async function scanAgent(agent, dir, filterName) {
  if (!(await exists(dir))) return [];
  const files = await walkJsonl(dir);
  const out = [];
  for (const file of files) {
    if (filterName && !filterName.test(path.basename(file))) continue;
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      continue;
    }
    const key = `${agent}:${file}`;
    const hit = cache.get(key);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
      out.push(hit.meta);
      continue;
    }
    try {
      const parsed = await parseMessages(agent, file);
      const meta = toMeta(agent, file, parsed, stat);
      cache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, meta });
      out.push(meta);
    } catch {
      continue;
    }
  }
  return out;
}

async function scanWorkBuddy() {
  const out = [];
  for (const dir of workbuddyRoots()) {
    out.push(...(await scanAgent('workbuddy', dir, /^[0-9a-f-]{36}\.jsonl$/i)));
  }
  return out;
}

export async function scanSessions() {
  const { qoder, claude, codex } = roots();
  const uuid = /^[0-9a-f-]{36}\.jsonl$/i;
  const rollout = /^rollout-.*\.jsonl$/i;
  const all = [
    ...(await scanAgent('qoder', qoder, uuid)),
    ...(await scanAgent('claude', claude, uuid)),
    ...(await scanAgent('codex', codex, rollout)),
    ...(await scanWorkBuddy()),
  ];
  const byId = new Map();
  for (const s of all) {
    const key = `${s.agent}:${s.id}`;
    const prev = byId.get(key);
    if (!prev || String(prev.updatedAt) < String(s.updatedAt)) byId.set(key, s);
  }
  const list = [...byId.values()];
  list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return list;
}

function snippet(text, q) {
  if (!q) return '';
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return '';
  const start = Math.max(0, i - 40);
  return (start > 0 ? '…' : '') + text.slice(start, i + q.length + 60).replace(/\s+/g, ' ') + '…';
}

export async function listSessions({ q = '', agent = '', limit = 80 } = {}) {
  const all = await scanSessions();
  let items = all;
  if (agent) items = items.filter((s) => s.agent === agent);
  if (q) {
    const lq = q.toLowerCase();
    items = items
      .filter((s) => s.title.toLowerCase().includes(lq) || s.text.toLowerCase().includes(lq))
      .map((s) => ({ ...s, snippet: snippet(s.text, q) }));
  }
  const total = items.length;
  const trimmed = items.slice(0, limit).map(({ text, ...rest }) => rest);
  return { total, items: trimmed };
}

function sessionById(list, agent, id) {
  return list.find((s) => s.agent === agent && s.id === id) || null;
}

export async function getSession(agent, id) {
  const all = await scanSessions();
  const meta = sessionById(all, agent, id);
  if (!meta) return null;
  if (!meta.file) {
    return { ...meta, messages: [], note: '该 agent 的会话没有可读的本地消息文件，只同步了列表。' };
  }
  const parsed = await parseMessages(agent, meta.file);
  return { ...meta, messages: parsed.messages };
}

function extractPaths(text) {
  const found = new Set();
  const norm = text.replace(/\\\\/g, '\\');
  const win = norm.match(/[A-Za-z]:\\[^\s"'`<>|*?]+/g) || [];
  const posix = norm.match(/(?:^|\s)(~?\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)/g) || [];
  for (const raw of [...win, ...posix]) {
    const p = raw.trim().replace(/[.,;:)\]]+$/, '');
    const segs = p.split(/[\\/]+/).filter(Boolean);
    if (segs.length < 2 || segs[segs.length - 1].length < 2) continue;
    if (/\\[ntr](?![A-Za-z])/.test(p)) continue;
    found.add(p);
  }
  return [...found].slice(0, 12);
}

function userName(id) {
  return id === 'qoder'
    ? 'Qoder'
    : id === 'claude'
      ? 'Claude Code'
      : id === 'codex'
        ? 'Codex'
        : id === 'workbuddy'
          ? 'WorkBuddy'
          : id;
}

export async function makeHandoff(agent, id) {
  const s = await getSession(agent, id);
  if (!s) return null;
  const users = cleanupUsers(s.messages);
  const assistants = s.messages.filter((m) => m.role === 'assistant').map((m) => m.text);
  const allText = s.messages.map((m) => m.text).join('\n');
  const files = extractPaths(allText);

  const lines = [
    `# 交接：${s.title}`,
    '',
    `- 来源：${userName(agent)} · ${new Date(s.updatedAt).toLocaleString('zh-CN')}`,
    `- 消息：${s.count ?? '未知'} 条`,
    s.project ? `- 项目：${s.project}` : '',
    '',
    '## 任务',
    users[0] ? users[0].slice(0, 800) : '（无）',
    '',
    '## 过程要点',
    ...users.slice(1, 4).map((t, i) => `${i + 1}. ${t.replace(/\s+/g, ' ').slice(0, 200)}`),
    '',
    '## 最后结论',
    assistants.slice(-1)[0]?.slice(0, 1500) || '（无）',
    '',
    '## 关键文件',
    ...(files.length ? files.map((f) => `- ${f}`) : ['- （未识别到路径）']),
    '',
    '## 待办',
    '- 读取本文件后先确认上述结论是否仍然成立，再继续。',
    '',
    '---',
    `由 AgentHub 从 ${userName(agent)} 的会话生成，原会话未改动。`,
  ].filter((l) => l !== '');

  const markdown = lines.join('\n');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = s.title.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 30) || 'session';
  const out = path.join(HANDOFF_DIR, `${stamp}-${slug}.md`);
  await writeFileAtomic(out, markdown);
  return { markdown, path: out };
}

export async function makeDraft(agent, id) {
  const s = await getSession(agent, id);
  if (!s) return null;
  const last = [...s.messages].reverse().find((m) => m.role === 'assistant');
  const body = last
    ? `来自会话《${s.title}》的结论草稿，确认后改成一条稳定事实：\n\n${last.text.slice(0, 600)}`
    : `来自会话《${s.title}》，请补充要长期记住的结论。`;
  return { title: s.title.slice(0, 60), body };
}

export async function exportSession(agent, id) {
  const s = await getSession(agent, id);
  if (!s) return null;
  const msgs = s.messages || [];
  const users = msgs.filter((m) => m.role === 'user').length;
  const assistants = msgs.filter((m) => m.role === 'assistant').length;
  const tools = msgs.filter((m) => m.role === 'tool').length;
  const times = msgs.map((m) => m.time).filter(Boolean);
  const first = times.length ? new Date(times[0]) : null;
  const last = times.length ? new Date(times[times.length - 1]) : null;
  const duration = first && last ? Math.max(1, Math.round((last - first) / 60000)) : null;
  const files = extractPaths(msgs.map((m) => m.text).join('\n'));

  const body = msgs
    .map((m, i) => {
      const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role === 'tool' ? '工具' : m.role;
      const when = m.time ? ` · ${new Date(m.time).toLocaleString('zh-CN')}` : '';
      return `### ${i + 1}. ${role}${when}\n\n${m.text}`;
    })
    .join('\n\n');

  const lines = [
    `# ${s.title}`,
    '',
    '## 会话信息',
    '',
    '| 项目 | 值 |',
    '| --- | --- |',
    `| Agent | ${userName(agent)} |`,
    '| 会话 ID | `' + s.id + '` |',
    `| 时间 | ${new Date(s.updatedAt).toLocaleString('zh-CN')} |`,
    `| 消息 | ${msgs.length} 条（用户 ${users} / 助手 ${assistants}${tools ? ` / 工具 ${tools}` : ''}） |`,
  ];
  if (duration !== null) lines.push(`| 时长 | 约 ${duration} 分钟 |`);
  if (s.project) lines.push('| 项目路径 | `' + s.project + '` |');
  lines.push('');
  if (files.length) {
    lines.push('## 涉及的文件', '');
    for (const f of files) lines.push('- `' + f + '`');
    lines.push('');
  }
  lines.push('## 对话记录', '', body || '（该会话没有可读消息）', '', '---', `由 AgentHub 导出 · ${new Date().toLocaleString('zh-CN')}`);
  return { markdown: lines.join('\n'), title: s.title };
}
