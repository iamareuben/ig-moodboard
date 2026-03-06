const BASE = '/api';

// Parse account/username from an Instagram or TikTok URL → '@username' or null
export function parseAccount(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const skip = ['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'video'];
    if (parts.length > 0) {
      const first = parts[0].replace(/^@/, '');
      if (first && !skip.includes(first)) return '@' + first;
    }
    return null;
  } catch {
    return null;
  }
}

export function isSocialUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    return host === 'instagram.com' || host === 'tiktok.com' ||
      host === 'vm.tiktok.com' || host === 't.tiktok.com' || host === 'vt.tiktok.com';
  } catch {
    return false;
  }
}

export const videoUrl = (id) => `/media/${id}/video.mp4`;
export const frameUrl = (id, t) => `/api/videos/${id}/frame?t=${t}`;
export const frameFileUrl = (id, frameFile) => `/media/${id}/${frameFile}`;

// --- Videos ---

export async function listVideos() {
  const res = await fetch(`${BASE}/videos`);
  if (!res.ok) throw new Error('Failed to list videos');
  return res.json();
}

export async function getVideo(id) {
  const res = await fetch(`${BASE}/videos/${id}`);
  if (!res.ok) throw new Error('Failed to get video');
  return res.json();
}

export async function submitVideo(url) {
  const res = await fetch(`${BASE}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Failed to submit video');
  }
  return res.json();
}

export async function retryVideo(id) {
  const res = await fetch(`${BASE}/videos/${id}/retry`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to retry video');
  return res.json();
}

export async function archiveVideo(id) {
  const res = await fetch(`${BASE}/videos/${id}/archive`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to archive video');
  return res.json();
}

export async function updateVideo(id, data) {
  const res = await fetch(`${BASE}/videos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update video');
  return res.json();
}

export async function addShot(id, timestamp) {
  const res = await fetch(`${BASE}/videos/${id}/shots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timestamp }),
  });
  if (!res.ok) throw new Error('Failed to add shot');
  return res.json();
}

export async function updateShot(id, shotId, data) {
  const res = await fetch(`${BASE}/videos/${id}/shots/${shotId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update shot');
  return res.json();
}

export async function deleteShot(id, shotId) {
  const res = await fetch(`${BASE}/videos/${id}/shots/${shotId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete shot');
  return res.json();
}

// --- Notes ---

export async function listNotes() {
  const res = await fetch(`${BASE}/notes`);
  if (!res.ok) throw new Error('Failed to list notes');
  return res.json();
}

export async function getNote(id) {
  const res = await fetch(`${BASE}/notes/${id}`);
  if (!res.ok) throw new Error('Failed to get note');
  return res.json();
}

export async function createNote(data = {}) {
  const res = await fetch(`${BASE}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create note');
  return res.json();
}

export async function updateNote(id, data) {
  const res = await fetch(`${BASE}/notes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update note');
  return res.json();
}

export async function deleteNote(id) {
  const res = await fetch(`${BASE}/notes/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete note');
  return res.json();
}

// --- Accounts ---

export async function listAccounts() {
  const res = await fetch(`${BASE}/accounts`);
  if (!res.ok) throw new Error('Failed to list accounts');
  return res.json();
}

export async function getAccount(id) {
  const res = await fetch(`${BASE}/accounts/${id}`);
  if (!res.ok) throw new Error('Failed to get account');
  return res.json();
}

export async function createAccount(data) {
  const res = await fetch(`${BASE}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to create account');
  }
  return res.json();
}

export async function updateAccount(id, data) {
  const res = await fetch(`${BASE}/accounts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update account');
  return res.json();
}

export async function deleteAccount(id) {
  const res = await fetch(`${BASE}/accounts/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete account');
  return res.json();
}

export async function getAccountLive(id, { platform, sort, limit } = {}) {
  const params = new URLSearchParams();
  if (platform) params.set('platform', platform);
  if (sort) params.set('sort', sort);
  if (limit) params.set('limit', limit);
  const res = await fetch(`${BASE}/accounts/${id}/live?${params}`);
  if (!res.ok) throw new Error('Failed to fetch live account data');
  return res.json();
}

export async function searchVideos(q) {
  const res = await fetch(`${BASE}/videos/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error('Failed to search videos');
  return res.json();
}

export async function syncIgBookmarks() {
  const res = await fetch(`${BASE}/videos/import-bookmarks/sync-ig`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Failed to sync IG bookmarks');
  }
  return res.json();
}

export async function addAnnotation(videoId, content) {
  const res = await fetch(`${BASE}/videos/${videoId}/annotations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error('Failed to add annotation');
  return res.json();
}

export async function deleteAnnotation(videoId, annotationId) {
  const res = await fetch(`${BASE}/videos/${videoId}/annotations/${annotationId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete annotation');
  return res.json();
}

export async function uploadVideo(file) {
  const form = new FormData();
  form.append('video', file);
  const res = await fetch(`${BASE}/videos/upload`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}

export async function transcribeVideo(id) {
  const res = await fetch(`${BASE}/videos/${id}/transcribe`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Transcription failed' }));
    throw new Error(err.error || 'Transcription failed');
  }
  return res.json();
}

export async function getCookieStatus() {
  const res = await fetch(`${BASE}/settings/cookies/status`);
  if (!res.ok) return {};
  return res.json();
}
