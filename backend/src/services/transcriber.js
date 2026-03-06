import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../transcribe.py');
const MODELS_DIR = join(__dirname, '../../data/models');

/**
 * Transcribe a video file using faster-whisper (on-device).
 * Returns { text, segments: [{start, end, text}], language }.
 */
export function transcribeVideo(videoPath, model = 'tiny') {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [SCRIPT, videoPath, model, MODELS_DIR]);

    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });

    proc.on('close', (code) => {
      const raw = out.trim();
      if (!raw) {
        reject(new Error(`Transcription process exited (code ${code}): ${err.slice(0, 400)}`));
        return;
      }
      try {
        const result = JSON.parse(raw);
        if (result.error) {
          reject(new Error(result.error));
        } else {
          resolve(result);
        }
      } catch {
        reject(new Error(`Failed to parse transcription output: ${raw.slice(0, 200)}`));
      }
    });

    proc.on('error', (e) => reject(new Error(`Failed to spawn transcription: ${e.message}`)));
  });
}
