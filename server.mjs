import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listMemories, createMemory, updateMemory, deleteMemory, DATA_DIR, BACKUP_DIR, HOME } from './lib/store.mjs';
import { listAgents, syncAgent, scanSkills, applySkill, importSkill, readSkillDoc, importSkillPath } from './lib/agents.mjs';
import { listSessions, getSession, makeHandoff, makeDraft, exportSession, scanSessions } from './lib/sessions.mjs';
import { scanMcp, toggleMcp, addMcp, importMcp } from './lib/mcp.mjs';
import { listCandidates, importCandidate } from './lib/import.mjs';
import { readConfig, setAgentPref } from './lib/config.mjs';

const PORT = Number(process.env.PORT || 4173);

function webRoot() {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}
const WEB = path.join(webRoot(), 'web');

let seaMod;
async function seaApi() {
  if (seaMod === undefined) {
    try {
      seaMod = await import('node:sea');
    } catch {
      seaMod = null;
    }
  }
  return seaMod;
}

function openBrowser(url) {
  try {
    const [cmd, args] =
      process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin'
          ? ['open', [url]]
          : ['xdg-open', [url]];
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* ignore */
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function buildState() {
  const memories = await listMemories();
  const agents = await listAgents(memories);
  const skills = await scanSkills(memories);
  const mcp = await scanMcp();
  const cfg = await readConfig();
  const withPrefs = agents.map((a) => ({
    ...a,
    sync: cfg.agents[a.id]?.sync !== false,
    defaultTarget: cfg.agents[a.id]?.defaultTarget !== false,
  }));
  return {
    memories,
    agents: withPrefs,
    skills,
    mcp,
    paths: { data: DATA_DIR, backups: BACKUP_DIR, home: HOME },
    stats: {
      memories: memories.length,
      agents: agents.filter((a) => a.installed).length,
      distributed: memories.filter((m) => m.targets.length > 0).length,
      skills: skills.items.length,
    },
  };
}

async function buildOverview() {
  const memories = await listMemories();
  const agents = await listAgents(memories);
  const skills = await scanSkills(memories);
  const mcp = await scanMcp();
  const sessions = await scanSessions();
  const cfg = await readConfig();

  const rows = agents.map((a) => {
    const pref = cfg.agents[a.id] || {};
    const own = sessions.filter((s) => s.agent === a.id);
    const lastActive = own.reduce((max, s) => (s.updatedAt > max ? s.updatedAt : max), '');
    return {
      id: a.id,
      name: a.name,
      color: a.color,
      icon: a.icon,
      installed: a.installed,
      sync: pref.sync !== false,
      defaultTarget: pref.defaultTarget !== false,
      memories: memories.filter((m) => m.targets.includes(a.id)).length,
      skills: Object.keys(skills.byAgent[a.id] || {}).length,
      sessions: own.length,
      mcp: mcp.agents.find((x) => x.id === a.id)?.count || 0,
      lastActive: lastActive || null,
    };
  });

  const days = [];
  const now = new Date();
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    );
  }
  const activity = days.map((date) => {
    const byAgent = {};
    for (const s of sessions) {
      if (String(s.updatedAt).slice(0, 10) !== date) continue;
      byAgent[s.agent] = (byAgent[s.agent] || 0) + 1;
    }
    return { date, byAgent };
  });

  return {
    rows,
    days,
    activity,
    totalSessions: sessions.length,
    totals: {
      memories: memories.length,
      skills: skills.items.length,
      mcp: mcp.items.length,
      agents: rows.filter((r) => r.installed).length,
    },
  };
}

async function openPath(target) {
  if (!target) throw new Error('缺少路径');
  const raw = String(target);
  if (raw.startsWith('\\') || raw.startsWith('//')) throw new Error('不允许网络路径');
  const abs = path.resolve(raw);
  await fs.access(abs).catch(() => {
    throw new Error('路径不存在');
  });
  const child = spawn('explorer.exe', [abs], { detached: true, stdio: 'ignore' });
  child.unref();
  return { ok: true, path: abs };
}

function pickFolder() {
  return new Promise((resolve, reject) => {
    const script =
      "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='选择技能文件夹（第一层要有 SKILL.md）'; if($d.ShowDialog() -eq 'OK'){ [Console]::Out.Write($d.SelectedPath) }";
    const ps = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script]);
    let out = '';
    ps.stdout.on('data', (d) => {
      out += d.toString('utf8');
    });
    ps.on('error', reject);
    ps.on('close', () => resolve({ path: out.trim() }));
  });
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (rel.includes('..')) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  const sea = await seaApi();
  if (sea?.isSea()) {
    try {
      const data = Buffer.from(sea.getAsset(`web/${rel}`));
      res.writeHead(200, {
        'content-type': MIME[path.extname(rel)] || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
    return;
  }
  const file = path.normalize(path.join(WEB, rel));
  if (!file.startsWith(WEB)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  try {
    const allowed = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
    if (!allowed.includes(req.headers.host || '')) {
      return json(res, 403, { error: 'forbidden host' });
    }
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${PORT}` && origin !== `http://localhost:${PORT}`) {
      return json(res, 403, { error: 'forbidden origin' });
    }
    if ((req.method === 'POST' || req.method === 'PUT') && !String(req.headers['content-type'] || '').startsWith('application/json')) {
      return json(res, 415, { error: 'content-type must be application/json' });
    }

    if (p === '/api/health') return json(res, 200, { ok: true });
    if (p === '/api/state' && req.method === 'GET') return json(res, 200, await buildState());

    if (p === '/api/memories' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.title || !body.body) return json(res, 400, { error: '标题和内容都不能为空' });
      await createMemory(body);
      return json(res, 200, await buildState());
    }

    const memMatch = p.match(/^\/api\/memories\/([\w-]+)$/);
    if (memMatch && req.method === 'PUT') {
      const body = await readBody(req);
      const updated = await updateMemory(memMatch[1], body);
      if (!updated) return json(res, 404, { error: '记忆不存在' });
      return json(res, 200, await buildState());
    }
    if (memMatch && req.method === 'DELETE') {
      await deleteMemory(memMatch[1]);
      return json(res, 200, await buildState());
    }

    if (p === '/api/sync' && req.method === 'POST') {
      const body = await readBody(req);
      const ids = Array.isArray(body.agentIds) ? body.agentIds : [];
      if (!ids.length) return json(res, 400, { error: '没有选择要同步的 agent' });
      const memories = await listMemories();
      const results = [];
      for (const id of ids) {
        try {
          results.push(await syncAgent(id, memories));
        } catch (err) {
          results.push({ agent: id, error: err.message });
        }
      }
      return json(res, 200, { results, state: await buildState() });
    }

    if (p === '/api/skills/import-path' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await importSkillPath(body.path);
      return json(res, 200, { result, state: await buildState() });
    }

    const skillDoc = p.match(/^\/api\/skills\/([^/]+)\/doc$/);
    if (skillDoc && req.method === 'GET') {
      return json(res, 200, await readSkillDoc(decodeURIComponent(skillDoc[1])));
    }

    if (p === '/api/skills/apply' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.name || !body.agentId || !body.mode) {
        return json(res, 400, { error: '缺少参数' });
      }
      const result = await applySkill(body.name, body.agentId, body.mode);
      return json(res, 200, { result, state: await buildState() });
    }

    if (p === '/api/skills/import' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.name || !body.agentId) return json(res, 400, { error: '缺少参数' });
      const result = await importSkill(body.name, body.agentId);
      return json(res, 200, { result, state: await buildState() });
    }

    if (p === '/api/overview' && req.method === 'GET') {
      return json(res, 200, await buildOverview());
    }

    if (p === '/api/open-path' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, await openPath(body.path));
    }

    if (p === '/api/pick-folder' && req.method === 'POST') {
      return json(res, 200, await pickFolder());
    }

    if (p === '/api/settings' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.agentId) return json(res, 400, { error: '缺少 agentId' });
      await setAgentPref(body.agentId, body.patch || {});
      return json(res, 200, { state: await buildState() });
    }

    if (p === '/api/sessions' && req.method === 'GET') {
      return json(
        res,
        200,
        await listSessions({
          q: url.searchParams.get('q') || '',
          agent: url.searchParams.get('agent') || '',
          limit: Number(url.searchParams.get('limit') || 80),
        }),
      );
    }

    const sessMatch = p.match(/^\/api\/sessions\/(\w+)\/([\w-]+)(?:\/(handoff|export|draft))?$/);
    if (sessMatch) {
      const [, agent, id, action] = sessMatch;
      if (!action && req.method === 'GET') {
        const data = await getSession(agent, id);
        if (!data) return json(res, 404, { error: '找不到这段会话' });
        return json(res, 200, data);
      }
      if (action === 'handoff' && req.method === 'POST') {
        const data = await makeHandoff(agent, id);
        if (!data) return json(res, 404, { error: '找不到这段会话' });
        return json(res, 200, data);
      }
      if (action === 'export' && req.method === 'POST') {
        const data = await exportSession(agent, id);
        if (!data) return json(res, 404, { error: '找不到这段会话' });
        return json(res, 200, data);
      }
      if (action === 'draft' && req.method === 'POST') {
        const data = await makeDraft(agent, id);
        if (!data) return json(res, 404, { error: '找不到这段会话' });
        return json(res, 200, data);
      }
    }

    if (p === '/api/mcp/import' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.fromAgent || !body.toAgent || !Array.isArray(body.names) || !body.names.length) {
        return json(res, 400, { error: '缺少参数' });
      }
      const result = await importMcp(body.fromAgent, body.toAgent, body.names);
      return json(res, 200, { result, state: await buildState() });
    }

    if (p === '/api/mcp/add' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.agentId || !body.name) return json(res, 400, { error: '缺少参数' });
      const result = await addMcp(body);
      return json(res, 200, { result, state: await buildState() });
    }

    if (p === '/api/mcp/toggle' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.name || !body.agentId) return json(res, 400, { error: '缺少参数' });
      const result = await toggleMcp(body.name, body.agentId, !!body.enabled);
      return json(res, 200, { result, state: await buildState() });
    }

    if (p === '/api/import/candidates' && req.method === 'GET') {
      const agent = url.searchParams.get('agent') || '';
      return json(res, 200, { items: await listCandidates(agent) });
    }

    if (p === '/api/import' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.file) return json(res, 400, { error: '缺少文件名' });
      const memory = await importCandidate(body.agent || 'qoder', body.file, body.index ?? -1);
      return json(res, 200, { memory, state: await buildState() });
    }

    if (req.method === 'GET') return serveStatic(req, res, p);

    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    const url = `http://127.0.0.1:${PORT}`;
    console.log(`端口 ${PORT} 已被占用，打开现有实例：${url}`);
    openBrowser(url);
    setTimeout(() => process.exit(0), 500);
    return;
  }
  console.error(err);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`AgentHub 已启动：${url}`);
  const sea = await seaApi();
  if (sea?.isSea() || process.env.AGENTHUB_OPEN === '1') openBrowser(url);
});