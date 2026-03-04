import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getCookies } from './db.js';

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

function platformForUrl(url) {
  if (url.includes('tiktok.com')) return 'tiktok';
  if (url.includes('instagram.com')) return 'instagram';
  return null;
}

/**
 * If we have stored cookies for this platform, write a Netscape cookie file,
 * call fn with ['--cookies', path, '--impersonate', 'chrome'], then clean up.
 */
async function withCookieArgs(url, fn) {
  const platform = platformForUrl(url);
  const row = platform ? getCookies(platform) : null;
  if (!row?.cookies_txt) return fn([]);

  const tmpPath = join(tmpdir(), `ytdlp-${platform}-${Date.now()}.txt`);
  writeFileSync(tmpPath, row.cookies_txt, 'utf8');
  try {
    return await fn(['--cookies', tmpPath, '--impersonate', 'chrome']);
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
}

export async function downloadVideo(url, outputPath) {
  await withCookieArgs(url, (cookieArgs) =>
    runProcess('yt-dlp', [
      ...cookieArgs,
      '-f', 'mp4/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--max-filesize', '500m',
      '-o', outputPath,
      url,
    ])
  );
}

export async function getVideoDuration(videoPath) {
  const { stdout } = await runProcess('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    videoPath,
  ]);

  const info = JSON.parse(stdout);
  return parseFloat(info.format.duration);
}

/**
 * Fetch video metadata from yt-dlp without downloading the video.
 * Returns a normalised metadata object.
 */
export async function getVideoMetadata(url) {
  try {
    const { stdout } = await withCookieArgs(url, (cookieArgs) =>
      runProcess('yt-dlp', [
        ...cookieArgs,
        '--dump-json',
        '--skip-download',
        '--no-playlist',
        url,
      ])
    );
    const raw = JSON.parse(stdout);
    return {
      title: raw.title || raw.fulltitle || '',
      description: raw.description || '',
      canonicalId: raw.id ? `${raw.extractor_key?.toLowerCase() || 'unknown'}:${raw.id}` : null,
      webpageUrl: raw.webpage_url || url,
      uploaderUsername: (() => {
        const uid = raw.uploader_id?.replace(/^@/, '');
        // Purely numeric = numeric user ID, not a handle — skip it
        if (uid && /^\d+$/.test(uid)) return null;
        return uid || null;
      })(),
      uploaderDisplayName: raw.uploader || raw.channel || null,
      thumbnailUrl: raw.thumbnail || null,
      stats: {
        viewCount: raw.view_count ?? null,
        likeCount: raw.like_count ?? null,
        commentCount: raw.comment_count ?? null,
        shareCount: raw.repost_count ?? raw.share_count ?? null,
      },
    };
  } catch (err) {
    console.warn('[metadata] yt-dlp dump-json failed:', err.message);
    return null;
  }
}

/**
 * Fetch an account's public video list using yt-dlp.
 * Returns array of video metadata objects (no download).
 */
export async function getAccountVideos(profileUrl, limit = 20) {
  try {
    const { stdout } = await withCookieArgs(profileUrl, (cookieArgs) =>
      runProcess('yt-dlp', [
        ...cookieArgs,
        '--dump-json',
        '--skip-download',
        '--no-playlist',
        '--playlist-end', String(limit),
        profileUrl,
      ])
    );
    // yt-dlp dumps one JSON object per line for playlists
    return stdout.trim().split('\n').map((line) => {
      try {
        const raw = JSON.parse(line);
        return {
          id: raw.id,
          title: raw.title || '',
          webpageUrl: raw.webpage_url || raw.url || '',
          thumbnailUrl: raw.thumbnail || null,
          uploaderUsername: raw.uploader_id?.replace(/^@/, '') || null,
          stats: {
            viewCount: raw.view_count ?? null,
            likeCount: raw.like_count ?? null,
            commentCount: raw.comment_count ?? null,
          },
          uploadDate: raw.upload_date || null, // YYYYMMDD
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch (err) {
    console.warn('[account-videos] yt-dlp failed:', err.message);
    return [];
  }
}
