import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeFilename(filename = 'upload.bin') {
  const cleaned = String(filename).replace(/[\r\n"]/g, '_').split(/[\\/]/).pop();
  return !cleaned || cleaned === '.' || cleaned === '..' ? 'upload.bin' : cleaned;
}

export function createUploadStore(options = {}) {
  const directory = options.directory || join(tmpdir(), 'wemp-operator-mcp-uploads');
  const maxBytes = positiveNumber(options.maxBytes ?? process.env.WEMP_MCP_UPLOAD_MAX_BYTES, 50 * 1024 * 1024);
  const totalBytes = positiveNumber(options.totalBytes ?? process.env.WEMP_MCP_UPLOAD_TOTAL_BYTES, 500 * 1024 * 1024);
  const ttlSeconds = positiveNumber(options.ttlSeconds ?? process.env.WEMP_MCP_UPLOAD_TTL_SECONDS, 900);
  const now = options.now || Date.now;
  const entries = new Map();
  let inFlightBytes = 0;
  let initialized;

  async function initialize() {
    if (!initialized) {
      initialized = (async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        for (const name of await readdir(directory)) {
          await rm(join(directory, name), { recursive: true, force: true });
        }
      })();
    }
    return initialized;
  }

  async function removeEntry(uploadId) {
    const entry = entries.get(uploadId);
    if (!entry) return;
    entries.delete(uploadId);
    await rm(entry.entryDirectory, { recursive: true, force: true });
  }

  async function cleanupExpired() {
    const timestamp = now();
    await Promise.all([...entries.values()]
      .filter((entry) => entry.expiresAtMs <= timestamp && entry.leases === 0)
      .map((entry) => removeEntry(entry.uploadId)));
  }

  function currentBytes() {
    return [...entries.values()].reduce((sum, entry) => sum + entry.size, 0);
  }

  function assertCapacity(additionalBytes) {
    if (currentBytes() + inFlightBytes + additionalBytes > totalBytes) {
      throw codedError('UPLOAD_QUOTA_EXCEEDED', 'Temporary upload quota exceeded');
    }
  }

  function reserveBytes(bytes) {
    assertCapacity(bytes);
    inFlightBytes += bytes;
  }

  function releaseBytes(bytes) {
    inFlightBytes = Math.max(0, inFlightBytes - bytes);
  }

  async function saveStream(stream, metadata = {}) {
    await initialize();
    await cleanupExpired();
    const uploadId = randomUUID();
    const entryDirectory = join(directory, uploadId);
    const filename = safeFilename(metadata.filename);
    const filePath = join(entryDirectory, filename);
    let size = 0;
    let reservedBytes = 0;
    await mkdir(entryDirectory, { mode: 0o700 });

    stream.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        stream.destroy(codedError('FILE_TOO_LARGE', `File exceeds ${maxBytes} byte limit`));
        return;
      }
      try {
        reserveBytes(chunk.length);
        reservedBytes += chunk.length;
      } catch (error) {
        stream.destroy(error);
      }
    });

    try {
      await pipeline(stream, createWriteStream(filePath, { mode: 0o600, flags: 'wx' }));
    } catch (error) {
      releaseBytes(reservedBytes);
      await rm(entryDirectory, { recursive: true, force: true });
      throw error;
    }

    const entry = {
      uploadId,
      entryDirectory,
      filePath,
      filename,
      mimeType: metadata.mimeType || 'application/octet-stream',
      size,
      expiresAtMs: now() + ttlSeconds * 1000,
      leases: 0,
    };
    entries.set(uploadId, entry);
    releaseBytes(reservedBytes);
    return publicEntry(entry);
  }

  async function resolve(uploadId) {
    await initialize();
    await cleanupExpired();
    const entry = entries.get(uploadId);
    if (!entry) throw codedError('UPLOAD_NOT_FOUND', 'Upload does not exist or has expired');
    try {
      await stat(entry.filePath);
    } catch {
      entries.delete(uploadId);
      throw codedError('UPLOAD_NOT_FOUND', 'Upload does not exist or has expired');
    }
    return { ...entry };
  }

  async function acquire(uploadId) {
    await initialize();
    await cleanupExpired();
    const stored = entries.get(uploadId);
    if (!stored) throw codedError('UPLOAD_NOT_FOUND', 'Upload does not exist or has expired');
    stored.leases += 1;
    try {
      await stat(stored.filePath);
    } catch {
      stored.leases = Math.max(0, stored.leases - 1);
      await removeEntry(uploadId);
      throw codedError('UPLOAD_NOT_FOUND', 'Upload does not exist or has expired');
    }
    let released = false;
    return {
      ...stored,
      release: async () => {
        if (released) return;
        released = true;
        const current = entries.get(uploadId);
        if (!current) return;
        current.leases = Math.max(0, current.leases - 1);
        if (current.leases === 0 && current.expiresAtMs <= now()) await removeEntry(uploadId);
      },
    };
  }

  function publicEntry(entry) {
    return {
      uploadId: entry.uploadId,
      filename: entry.filename,
      mimeType: entry.mimeType,
      size: entry.size,
      expiresAt: new Date(entry.expiresAtMs).toISOString(),
    };
  }

  const interval = setInterval(() => cleanupExpired().catch(() => {}), Math.min(ttlSeconds * 1000, 60_000));
  interval.unref();

  return {
    directory,
    maxBytes,
    totalBytes,
    ttlSeconds,
    initialize,
    saveStream,
    resolve,
    acquire,
    cleanupExpired,
    removeEntry,
    assertCapacity,
    reserveBytes,
    releaseBytes,
  };
}

export { codedError };
