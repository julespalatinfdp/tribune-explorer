import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const dir = path.resolve(process.cwd(), config.exportsDir);

export async function ensureDir() {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function buildFileName(channelName, { prefix = 'export', suffix = null } = {}) {
  const safeChannel = channelName.replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
  const safeSuffix = suffix
    ? String(suffix).replace(/[^a-z0-9-_]/gi, '-')
    : new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${prefix}_${safeChannel}_${safeSuffix}.csv`;
}

export async function saveCsv(fileName, csv) {
  await ensureDir();
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, csv, 'utf8');
  const { size } = await fs.stat(filePath);
  return { filePath, size };
}

export async function listExports() {
  await ensureDir();
  const files = await fs.readdir(dir);
  const details = await Promise.all(
    files
      .filter((f) => f.endsWith('.csv'))
      .map(async (f) => {
        const stat = await fs.stat(path.join(dir, f));
        return { name: f, size: stat.size, createdAt: stat.mtime.toISOString() };
      })
  );
  return details.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function resolveExportPath(fileName) {
  const safe = path.basename(fileName);
  return path.join(dir, safe);
}

/**
 * Supprime les exports plus vieux que la durée de rétention configurée.
 * Important : le disque Railway est éphémère, cette purge évite juste de saturer l'instance.
 */
export async function purgeOldExports() {
  const files = await listExports();
  const cutoff = Date.now() - config.retentionHours * 3600 * 1000;
  let removed = 0;
  for (const file of files) {
    if (new Date(file.createdAt).getTime() < cutoff) {
      await fs.unlink(resolveExportPath(file.name)).catch(() => {});
      removed += 1;
    }
  }
  if (removed > 0) console.log(`[storage] ${removed} export(s) purgé(s).`);
  return removed;
}
