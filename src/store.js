import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createStore(dir) {
  async function save(run) {
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${run.id}.json`);
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(run, null, 2), { mode: 0o600 });
    await rename(temp, path);
    return run;
  }

  async function get(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    try {
      return JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  return { save, get };
}
