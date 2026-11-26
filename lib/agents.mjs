import fs from 'node:fs/promises';
import path from 'node:path';
import { HOME, SKILL_DIR, BACKUP_DIR, backupFile, writeFileAtomic } from './store.mjs';

const BEGIN = '<!-- agenthub:begin -->';
const END = '<!-- agenthub:end -->';
const MARKER = '.agenthub.json';

export const AGENTS = [
  {
    id: 'claude',
    name: 'Claude Code',
    color: '#d97757',
    icon: { file: 'claude.svg', kind: 'mask' },
    root: path.join(HOME, '.claude'),
    memory: { mode: 'block', file: path.join(HOME, '.claude', 'CLAUDE.md') },
    skillsDir: path.join(HOME, '.claude', 'skills'),
    caps: { memory: 'rw', skills: 'rw' },
  },
  {
    id: 'codex',
    name: 'Codex',
    color: 'currentColor',
    icon: { file: 'openai.svg', kind: 'mask' },
    root: path.join(HOME, '.codex'),
    memory: { mode: 'block', file: path.join(HOME, '.codex', 'AGENTS.md') },
    skillsDir: null,
    caps: { memory: 'rw', skills: 'none' },
  },
  {
    id: 'qoder',
    name: 'Qoder',
    color: '#2f6bff',
    icon: { file: 'qoder.png', kind: 'img' },
    root: path.join(HOME, '.qoder-cn'),
    memory: {
      mode: 'files',
      dir: path.join(HOME, '.qoder-cn', 'memory'),
      index: path.join(HOME, '.qoder-cn', 'memory', 'MEMORY.md'),
      prefix: 'agenthub-',
    },
    skillsDir: path.join(HOME, '.qoder-cn', 'skills'),
    caps: { memory: 'rw', skills: 'rw' },
  },
  {
    id: 'workbuddy',
    name: 'WorkBuddy',
    color: '#8b5cf6',
    icon: { file: 'workbuddy.png', kind: 'img' },
    root: path.join(HOME, '.workbuddy'),
    memory: { mode: 'block', file: path.join(HOME, '.workbuddy', 'USER.md') },
    skillsDir: path.join(HOME, '.workbuddy', 'skills'),
    caps: { memory: 'rw', skills: 'rw' },
  },
  {
    id: 'doubao',
    name: '豆包',
    color: '#3f6bff',
    icon: { file: null, kind: 'text' },
    root: null,
    memory: { mode: 'none' },
    skillsDir: null,
    caps: { memory: 'none', skills: 'none' },
  },
];

async function exists(target) {
  if (!target) return false;
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function firstLine(text, max = 60) {
  const line = text.split(/\r?\n/).find((s) => s.trim()) || '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

function renderBlock(memories) {
  const parts = [BEGIN, '## 共享记忆（AgentHub 自动生成，请勿手改）', ''];
  for (const m of memories) {
    parts.push(`### ${m.title}`, '', m.body.trim(), '');
  }
  parts.push(END);
  return parts.join('\n');
}

function renderIndexBlock(memories, prefix) {
  const lines = [BEGIN, '## 共享记忆（AgentHub）', ''];
  for (const m of memories) {
    lines.push(`- [${m.title}](${prefix}${m.id}.md) — ${firstLine(m.body)}`);
  }
  lines.push(END);
  return lines.join('\n');
}

function renderQoderMemory(m) {
  return [
    '---',
    `name: agenthub-${m.id}`,
    `description: ${m.title}`,
    'metadata:',
    `  type: ${m.scope}`,
    '  category: agenthub',
    '  source: agenthub',
    '---',
    '',
    m.body.trim(),
    '',
  ].join('\n');
}

function upsertBlock(text, block) {
  const b = text.indexOf(BEGIN);
  const e = text.indexOf(END);
  if (b !== -1 && e > b) {
    return text.slice(0, b) + block + text.slice(e + END.length);
  }
  const sep = text.trim() ? (text.endsWith('\n') ? '\n' : '\n\n') : '';
  return `${text}${sep}${block}\n`;
}

function removeBlock(text) {
  return text
    .replace(/\n*<!-- agenthub:begin -->[\s\S]*?<!-- agenthub:end -->\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

async function applyBlock(agent, memories) {
  const file = agent.memory.file;
  let text = '';
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    text = '';
  }
  const next = memories.length ? upsertBlock(text, renderBlock(memories)) : removeBlock(text);
  if (next === text) return { changed: false, file };
  const backup = await backupFile(file, agent.id);
  await writeFileAtomic(file, next);
  return { changed: true, file, backup };
}

async function applyFiles(agent, memories) {
  const { dir, index, prefix } = agent.memory;
  await fs.mkdir(dir, { recursive: true });

  const wanted = new Set(memories.map((m) => `${prefix}${m.id}.md`));
  const entries = await fs.readdir(dir).catch(() => []);
  const removed = [];
  for (const name of entries) {
    if (name.startsWith(prefix) && name.endsWith('.md') && !wanted.has(name)) {
      await fs.unlink(path.join(dir, name));
      removed.push(name);
    }
  }

  const written = [];
  for (const m of memories) {
    const file = path.join(dir, `${prefix}${m.id}.md`);
    const next = renderQoderMemory(m);
    let prev = '';
    try {
      prev = await fs.readFile(file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      prev = '';
    }
    if (prev === next) continue;
    if (prev) await backupFile(file, agent.id);
    await writeFileAtomic(file, next);
    written.push(file);
  }

  let indexText = '';
  try {
    indexText = await fs.readFile(index, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    indexText = '';
  }
  const nextIndex = memories.length
    ? upsertBlock(indexText, renderIndexBlock(memories, prefix))
    : removeBlock(indexText);
  let indexChanged = false;
  if (nextIndex !== indexText) {
    if (indexText) await backupFile(index, agent.id);
    await writeFileAtomic(index, nextIndex);
    indexChanged = true;
  }

  return { written, removed, index, indexChanged, dir };
}

export async function listAgents(memories = []) {
  const out = [];
  for (const a of AGENTS) {
    const installed = await exists(a.root);
    out.push({
      id: a.id,
      name: a.name,
      color: a.color,
      icon: a.icon,
      installed,
      caps: a.caps,
      memoryPath: a.memory.mode === 'block' ? a.memory.file : a.memory.mode === 'files' ? a.memory.dir : null,
      skillsPath: a.skillsDir,
      synced: memories.filter((m) => m.targets.includes(a.id)).length,
    });
  }
  return out;
}

export async function syncAgent(id, memories) {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) throw new Error(`未知 agent: ${id}`);
  if (agent.memory.mode === 'none') {
    return { agent: id, skipped: true, reason: '该 agent 没有可写入的本地记忆文件' };
  }
  if (!(await exists(agent.root))) {
    return { agent: id, skipped: true, reason: '未检测到安装目录' };
  }

  const targeted = memories.filter((m) => m.targets.includes(id));
  const result =
    agent.memory.mode === 'block'
      ? await applyBlock(agent, targeted)
      : await applyFiles(agent, targeted);
  return { agent: id, name: agent.name, count: targeted.length, ...result };
}

async function listSkillDirs(dir) {
  if (!dir) return [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(
        (e) =>
          (e.isDirectory() || e.isSymbolicLink()) &&
          !e.name.startsWith('.') &&
          !e.name.startsWith('_'),
      )
      .map((e) => e.name);
  } catch {
    return [];
  }
}

async function statKind(target) {
  try {
    const st = await fs.lstat(target);
    if (st.isSymbolicLink()) return 'link';
    if (st.isDirectory()) return 'copy';
    return 'file';
  } catch {
    return null;
  }
}

async function isManagedCopy(dir) {
  try {
    await fs.access(path.join(dir, MARKER));
    return true;
  } catch {
    return false;
  }
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function readSkillDescription(dir) {
  try {
    const text = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8');
    const fm = text.match(/^---[\s\S]*?\n---/);
    if (fm) {
      const m = fm[0].match(/^description:\s*(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '').slice(0, 180);
    }
    const body = text.replace(/^---[\s\S]*?\n---/, '');
    const line = body.split(/\r?\n/).map((s) => s.trim()).find((s) => s && !s.startsWith('#'));
    return (line || '').slice(0, 180);
  } catch {
    return '';
  }
}

export async function scanSkills() {
  const library = await listSkillDirs(SKILL_DIR);
  const byAgent = {};
  const found = new Map();
  const firstDir = new Map();

  for (const a of AGENTS) {
    if (!a.skillsDir || !(await exists(a.root))) continue;
    const names = await listSkillDirs(a.skillsDir);
    byAgent[a.id] = {};
    for (const n of names) {
      const p = path.join(a.skillsDir, n);
      const kind = await statKind(p);
      let status = 'external';
      if (kind === 'link') status = 'link';
      else if (kind === 'copy' && (await isManagedCopy(p))) status = 'copy';
      byAgent[a.id][n] = status;
      if (!found.has(n)) found.set(n, { agents: [], byAgent: {} });
      if (!firstDir.has(n)) firstDir.set(n, p);
      const entry = found.get(n);
      entry.agents.push(a.id);
      entry.byAgent[a.id] = status;
    }
  }

  const names = [...new Set([...library, ...found.keys()])].sort((x, y) => x.localeCompare(y));
  const items = [];
  for (const name of names) {
    const inLibrary = library.includes(name);
    const dir = inLibrary ? path.join(SKILL_DIR, name) : firstDir.get(name);
    items.push({
      name,
      inLibrary,
      agents: found.get(name)?.agents || [],
      byAgent: found.get(name)?.byAgent || {},
      description: await readSkillDescription(dir),
    });
  }

  return { library, items, byAgent };
}

export async function readSkillDoc(name) {
  if (!/^[\w.@\-一-龥]{1,80}$/.test(name) || name.includes('..') || name.startsWith('.')) throw new Error('非法技能名');
  const candidates = [path.join(SKILL_DIR, name)];
  for (const a of AGENTS) {
    if (a.skillsDir) candidates.push(path.join(a.skillsDir, name));
  }
  for (const dir of candidates) {
    if (!(await exists(dir))) continue;
    let file = path.join(dir, 'SKILL.md');
    if (!(await exists(file))) {
      const entries = await fs.readdir(dir).catch(() => []);
      const md = entries.find((f) => /\.md$/i.test(f));
      if (!md) continue;
      file = path.join(dir, md);
    }
    const text = await fs.readFile(file, 'utf8');
    return { name, path: dir, file, text: text.slice(0, 30000) };
  }
  throw new Error('找不到这个技能的 SKILL.md');
}

export async function importSkillPath(srcPath) {
  if (!srcPath) throw new Error('缺少路径');
  const src = path.resolve(srcPath.replace(/^["']|["']$/g, ''));
  if (!(await exists(src))) throw new Error('路径不存在');
  const st = await fs.stat(src);
  if (!st.isDirectory()) throw new Error('要选一个文件夹');
  const name = path.basename(src);
  if (!/^[\w.@-]{1,80}$/.test(name)) throw new Error('文件夹名只能用字母数字和 _ . - @');
  if (!(await exists(path.join(src, 'SKILL.md')))) throw new Error('这个文件夹第一层没有 SKILL.md');
  const dest = path.join(SKILL_DIR, name);
  if (await exists(dest)) throw new Error('中心库已有同名技能');
  await fs.cp(src, dest, { recursive: true });
  return { name, from: src };
}

export async function applySkill(name, agentId, mode) {
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) throw new Error('未知 agent');
  if (!agent.skillsDir) throw new Error(`${agent.name} 没有技能目录`);
  if (!(await exists(agent.root))) throw new Error(`${agent.name} 未检测到安装目录`);

  const libDir = path.join(SKILL_DIR, name);
  if (!(await exists(libDir))) throw new Error('中心库里没有这个技能，先点「收进中心库」');
  if (name.startsWith('.') || name.includes('/') || name.includes('\\')) {
    throw new Error('非法技能名');
  }

  const target = path.join(agent.skillsDir, name);
  const current = await statKind(target);
  const unmanaged = current === 'copy' && !(await isManagedCopy(target));

  if (mode === 'none') {
    if (current === 'link') {
      await fs.unlink(target);
      return { name, mode: 'none', removed: 'link' };
    }
    if (current === 'copy') {
      if (unmanaged) {
        throw new Error('这个目录是手工放的，工具不删，请自己处理');
      }
      const dest = path.join(BACKUP_DIR, stamp(), agentId, 'skills');
      await fs.mkdir(dest, { recursive: true });
      await fs.rename(target, path.join(dest, name));
      return { name, mode: 'none', removed: 'copy' };
    }
    return { name, mode: 'none', removed: null };
  }

  if (current && !(unmanaged && mode === 'link')) {
    throw new Error('目标位置已有同名目录，先设为「不装」再试');
  }
  await fs.mkdir(agent.skillsDir, { recursive: true });

  if (mode === 'link') {
    let adopted = false;
    if (unmanaged) {
      const dest = path.join(BACKUP_DIR, stamp(), agentId, 'skills');
      await fs.mkdir(dest, { recursive: true });
      await fs.rename(target, path.join(dest, name));
      adopted = true;
    }
    await fs.symlink(libDir, target, process.platform === 'win32' ? 'junction' : 'dir');
    return { name, mode: 'link', adopted };
  }
  if (mode === 'copy') {
    await fs.cp(libDir, target, { recursive: true });
    await fs.writeFile(
      path.join(target, MARKER),
      `${JSON.stringify({ name, source: libDir, installedAt: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    );
    return { name, mode: 'copy' };
  }
  throw new Error('未知模式');
}

export async function importSkill(name, agentId) {
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent || !agent.skillsDir) throw new Error('该 agent 没有技能目录');
  const dir = path.join(agent.skillsDir, name);
  if (!(await exists(dir))) throw new Error('找不到这个技能目录');
  const libDir = path.join(SKILL_DIR, name);
  if (await exists(libDir)) throw new Error('中心库里已有同名技能');
  const real = await fs.realpath(dir);
  await fs.cp(real, libDir, { recursive: true });
  return { name, from: agentId };
}