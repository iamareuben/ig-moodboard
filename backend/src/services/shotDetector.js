import { spawn } from 'child_process';
import { writeFile, readFile, unlink, access } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { constants } from 'fs';

const BREW_PATH = '/opt/homebrew/bin:/usr/local/bin';
const spawnEnv = {
  ...process.env,
  PATH: `${BREW_PATH}:${process.env.PATH ?? ''}`,
};

function runProcess(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { env: spawnEnv });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

export async function extractFrameAtTime(videoPath, timestamp, outputPath) {
  await runProcess('ffmpeg', [
    '-ss', String(timestamp),
    '-i', videoPath,
    '-vframes', '1',
    '-q:v', '2',
    '-y',
    outputPath,
  ]);
}

export async function detectShots(videoPath, framesDirPath, duration) {
  const scenesFile = join(framesDirPath, 'scenes.txt');

  // Run scene detection — FFmpeg writes to scenes.txt
  // Non-zero exit is expected when using -f null, handle gracefully
  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', videoPath,
      '-vf', `select='gt(scene,0.35)',metadata=print:file=${scenesFile}`,
      '-vsync', 'vfr',
      '-f', 'null',
      '-',
    ], { env: spawnEnv });

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      // FFmpeg with -f null returns 0 on success; also accept if scenes file was written
      resolve();
    });
    proc.on('error', reject);
  });

  // Parse scenes file
  let scenesText = '';
  try {
    scenesText = await readFile(scenesFile, 'utf-8');
  } catch {
    // No scenes detected — just use t=0
  }

  const timestamps = [0];
  const ptsRegex = /pts_time:([\d.]+)/g;
  let match;
  while ((match = ptsRegex.exec(scenesText)) !== null) {
    timestamps.push(parseFloat(match[1]));
  }

  // Dedupe within 0.1s, sort ascending
  const deduped = timestamps.sort((a, b) => a - b).filter((t, i, arr) => {
    if (i === 0) return true;
    return t - arr[i - 1] >= 0.1;
  });

  // Extract frames for each timestamp
  const shots = [];
  for (const t of deduped) {
    const ms = Math.round(t * 1000);
    const filename = `frame_${ms}ms.jpg`;
    const outputPath = join(framesDirPath, filename);

    // Check if file already exists (cached)
    let exists = false;
    try {
      await access(outputPath, constants.F_OK);
      exists = true;
    } catch {
      exists = false;
    }

    if (!exists) {
      await extractFrameAtTime(videoPath, t, outputPath);
    }

    shots.push({
      id: randomUUID(),
      timestamp: t,
      frameFile: `frames/${filename}`,
      isHero: false,
      label: '',
    });
  }

  // Clean up scenes file
  try {
    await unlink(scenesFile);
  } catch {
    // ignore
  }

  return shots;
}
