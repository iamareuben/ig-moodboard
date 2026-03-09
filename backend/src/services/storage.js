import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdir, readFile, writeFile, rename, readdir } from 'fs/promises';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const VIDEOS_DIR = join(__dirname, '../../data/videos');

export const videoDir = (id) => join(VIDEOS_DIR, id);
export const framesDir = (id) => join(VIDEOS_DIR, id, 'frames');
export const videoFile = (id) => join(VIDEOS_DIR, id, 'video.mp4');
export const manifestFile = (id) => join(VIDEOS_DIR, id, 'manifest.json');
export const frameFile = (id, ms) => join(VIDEOS_DIR, id, 'frames', `frame_${ms}ms.jpg`);

export async function initVideoDir(id) {
  await mkdir(framesDir(id), { recursive: true });
}

export async function readManifest(id) {
  const data = await readFile(manifestFile(id), 'utf-8');
  return JSON.parse(data);
}

export async function writeManifest(id, data) {
  const tmp = manifestFile(id) + '.' + randomUUID() + '.tmp';
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, manifestFile(id));
}

export async function listManifests() {
  let entries;
  try {
    entries = await readdir(VIDEOS_DIR);
  } catch {
    return [];
  }

  const results = await Promise.all(
    entries.map(async (entry) => {
      try {
        const data = await readFile(join(VIDEOS_DIR, entry, 'manifest.json'), 'utf-8');
        return JSON.parse(data);
      } catch {
        return null;
      }
    })
  );
  const manifests = results.filter(Boolean);

  return manifests.sort((a, b) => {
    const aTime = a.downloadedAt ? new Date(a.downloadedAt).getTime() : 0;
    const bTime = b.downloadedAt ? new Date(b.downloadedAt).getTime() : 0;
    return bTime - aTime;
  });
}
