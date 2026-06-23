import { join } from 'path';
import { readFile } from 'fs/promises';

const VIDEOS_DIR = process.env.VIDEOS_DIR || join(process.cwd(), 'data', 'videos');

export async function readManifest(id) {
  const data = await readFile(join(VIDEOS_DIR, id, 'manifest.json'), 'utf-8');
  return JSON.parse(data);
}
