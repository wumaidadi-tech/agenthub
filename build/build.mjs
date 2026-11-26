import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(root, 'dist');
const b = here;
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function assetMap(dir, key) {
  const out = {};
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (e.isDirectory()) {
      Object.assign(out, assetMap(path.join(dir, e.name), `${key}/${e.name}`));
    } else {
      out[`${key}/${e.name}`] = path.join(root, dir, e.name);
    }
  }
  return out;
}

const sizes = [16, 32, 48, 64, 128, 256];
for (const s of sizes) {
  if (!fs.existsSync(path.join(b, `icon-${s}.png`))) {
    throw new Error(`缺少 build/icon-${s}.png，先运行 npm run icon`);
  }
}

const pngToIco = (await import('png-to-ico')).default;
const ico = await pngToIco(sizes.map((s) => path.join(b, `icon-${s}.png`)));
fs.writeFileSync(path.join(b, 'icon.ico'), ico);

const esbuild = path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild');
execFileSync(
  process.execPath,
  [
    esbuild,
    'server.mjs',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node22',
    '--outfile=build/server.cjs',
    '--external:node:*',
    '--log-level=warning',
  ],
  { cwd: root, stdio: 'inherit' },
);

const seaConfig = {
  main: path.join(b, 'server.cjs'),
  output: path.join(b, 'agenthub.blob'),
  disableExperimentalSEAWarning: true,
  assets: assetMap('web', 'web'),
};
fs.writeFileSync(path.join(b, 'sea.json'), JSON.stringify(seaConfig, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', path.join(b, 'sea.json')], {
  cwd: root,
  stdio: 'inherit',
});

fs.mkdirSync(dist, { recursive: true });
const exePath = path.join(dist, 'AgentHub.exe');
fs.copyFileSync(process.execPath, exePath);

const { NtExecutable, NtExecutableResource, Resource, Data } = await import('resedit');
const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = NtExecutableResource.from(exe);
const iconFile = Data.IconFile.from(fs.readFileSync(path.join(b, 'icon.ico')));
Resource.IconGroupEntry.replaceIconsForResource(
  res.entries,
  1,
  1033,
  iconFile.icons.map((i) => i.data),
);
const [vi] = Resource.VersionInfo.fromEntries(res.entries);
if (vi) {
  vi.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      FileDescription: 'AgentHub',
      ProductName: 'AgentHub',
      FileVersion: pkg.version,
      ProductVersion: pkg.version,
      OriginalFilename: 'AgentHub.exe',
    },
  );
  vi.outputToResourceEntries(res.entries);
}
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));

const postject = path.join(root, 'node_modules', 'postject', 'dist', 'cli.js');
execFileSync(
  process.execPath,
  [
    postject,
    exePath,
    'NODE_SEA_BLOB',
    path.join(b, 'agenthub.blob'),
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ],
  { stdio: 'inherit' },
);

console.log(`\n完成：${exePath}（${(fs.statSync(exePath).size / 1048576).toFixed(1)} MB）`);