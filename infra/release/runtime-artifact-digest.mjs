import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { lstat, readdir, readlink } from 'node:fs/promises';
import path from 'node:path';

const [mode, input] = process.argv.slice(2);
if (mode === 'filesystem') {
  process.stdout.write(`${await filesystemDigest(path.resolve(input ?? '/app'))}\n`);
} else if (mode === 'config') {
  process.stdout.write(`${configDigest(input)}\n`);
} else {
  throw new Error('Usage: runtime-artifact-digest.mjs <filesystem ROOT|config INSPECT_JSON>');
}

async function filesystemDigest(root) {
  const digest = createHash('sha256');
  await visit(root, '.', digest);
  return `sha256:${digest.digest('hex')}`;
}

async function visit(absolute, relative, digest) {
  const stat = await lstat(absolute);
  const type = stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : 'other';
  digest.update(`${JSON.stringify({ path: relative, type, mode: stat.mode & 0o7777, uid: stat.uid, gid: stat.gid })}\n`);
  if (type === 'symlink') {
    digest.update(`${await readlink(absolute)}\n`);
    return;
  }
  if (type === 'file') {
    await new Promise((resolve, reject) => {
      const stream = createReadStream(absolute);
      stream.on('data', (chunk) => digest.update(chunk));
      stream.on('error', reject);
      stream.on('end', resolve);
    });
    digest.update('\n');
    return;
  }
  if (type !== 'directory') throw new Error(`Unsupported runtime artifact entry: ${relative}`);
  const entries = await readdir(absolute);
  entries.sort((left, right) => left.localeCompare(right, 'en'));
  for (const entry of entries) {
    await visit(path.join(absolute, entry), relative === '.' ? entry : `${relative}/${entry}`, digest);
  }
}

function configDigest(inspectPath) {
  const inspected = JSON.parse(readFileSync(inspectPath, 'utf8'));
  const config = inspected[0]?.Config;
  if (!config) throw new Error('Docker image Config is missing.');
  const normalized = {
    User: config.User ?? '',
    Env: [...(config.Env ?? [])].sort(),
    Entrypoint: config.Entrypoint ?? null,
    Cmd: config.Cmd ?? null,
    WorkingDir: config.WorkingDir ?? '',
    ExposedPorts: stable(config.ExposedPorts ?? {}),
    Labels: stable(config.Labels ?? {}),
    Healthcheck: stable(config.Healthcheck ?? null),
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(normalized)).digest('hex')}`;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
