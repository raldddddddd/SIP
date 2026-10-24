import { randomUUID } from 'node:crypto';

export function createSnapshotRegistry() {
  const snapshots = new Map();

  function register(result) {
    const snapshotId = randomUUID();
    const source = {
      title: result.title,
      url: result.finalUrl,
      requestedUrl: result.url,
      excerpt: result.text,
      origin: 'fetched',
      fetchedAt: result.fetchedAt,
      sha256: result.sha256
    };
    snapshots.set(snapshotId, source);
    return { ...source, snapshotId };
  }

  function materialize(sources) {
    if (!Array.isArray(sources)) return sources;
    return sources.map(source => {
      if (source?.origin !== 'fetched' && !source?.snapshotId) return source;
      const saved = snapshots.get(source?.snapshotId);
      if (!saved) throw new Error('Fetched snapshot expired or is invalid. Fetch the page again.');
      return { ...saved };
    });
  }

  return { register, materialize };
}
