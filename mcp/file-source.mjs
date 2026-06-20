import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { codedError } from './upload-store.mjs';

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15_000;

function isForbiddenIpv4(address) {
  const parts = address.split('.').map(Number);
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || a >= 224;
}

function isForbiddenIpv6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isForbiddenIpv4(mappedIpv4);
  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('ff')
    || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:192.168.')
    || normalized.startsWith('::ffff:169.254.');
}

export function isForbiddenAddress(address) {
  const family = isIP(address);
  if (family === 4) return isForbiddenIpv4(address);
  if (family === 6) return isForbiddenIpv6(address);
  return true;
}

function safeRemoteUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw codedError('REMOTE_SOURCE_FORBIDDEN', 'Remote source URL is invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw codedError('REMOTE_SOURCE_FORBIDDEN', 'Remote source must be an HTTPS URL without credentials');
  }
  return url;
}

async function allowedAddresses(hostname, lookupImpl = lookup) {
  let addresses;
  try {
    addresses = await lookupImpl(hostname, { all: true, verbatim: true });
  } catch {
    throw codedError('REMOTE_SOURCE_FETCH_FAILED', 'Remote source hostname could not be resolved');
  }
  if (!addresses.length || addresses.some(({ address }) => isForbiddenAddress(address))) {
    throw codedError('REMOTE_SOURCE_FORBIDDEN', 'Remote source resolves to a restricted network');
  }
  return addresses;
}

function requestToFile(url, filePath, options) {
  return new Promise((resolve, reject) => {
    const allowed = new Set(options.addresses.map(({ address }) => address));
    let reservedBytes = 0;
    let settled = false;
    let totalTimer;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      options.releaseBytes(reservedBytes);
      reject(error);
    };
    const request = https.get(url, {
      timeout: options.timeoutMs,
      lookup: (_hostname, _lookupOptions, callback) => {
        const addresses = options.addresses.filter(({ address }) => allowed.has(address) && !isForbiddenAddress(address));
        if (!addresses.length) {
          callback(codedError('REMOTE_SOURCE_FORBIDDEN', 'Remote source connection address is restricted'));
          return;
        }
        if (_lookupOptions?.all) {
          callback(null, addresses);
          return;
        }
        callback(null, addresses[0].address, addresses[0].family);
      },
      headers: { 'User-Agent': 'wemp-operator-mcp/1.0' },
    });
    totalTimer = setTimeout(() => {
      request.destroy(codedError('REMOTE_SOURCE_FETCH_FAILED', 'Remote source download timed out'));
    }, options.timeoutMs);
    totalTimer.unref();

    request.on('timeout', () => request.destroy(codedError('REMOTE_SOURCE_FETCH_FAILED', 'Remote source download timed out')));
    request.on('error', fail);
    request.on('response', (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        settled = true;
        clearTimeout(totalTimer);
        resolve({ redirect: new URL(response.headers.location, url).toString() });
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        fail(codedError('REMOTE_SOURCE_FETCH_FAILED', `Remote source returned HTTP ${response.statusCode}`));
        return;
      }

      let size = 0;
      const output = createWriteStream(filePath, { mode: 0o600, flags: 'wx' });
      response.on('data', (chunk) => {
        if (settled) return;
        size += chunk.length;
        try {
          options.reserveBytes(chunk.length);
          reservedBytes += chunk.length;
        } catch (error) {
          response.destroy(error);
          return;
        }
        if (size > options.maxBytes) {
          response.destroy(codedError('REMOTE_SOURCE_FETCH_FAILED', 'Remote source exceeds maximum size'));
        }
      });
      response.on('error', fail);
      output.on('error', fail);
      output.on('finish', () => {
        if (settled) return;
        settled = true;
        clearTimeout(totalTimer);
        resolve({
          size,
          reservedBytes,
          mimeType: String(response.headers['content-type'] || 'application/octet-stream').split(';')[0],
        });
      });
      response.pipe(output);
    });
  });
}

export function createFileSourceResolver(options = {}) {
  const uploadStore = options.uploadStore;
  const lookupImpl = options.lookupImpl || lookup;
  const timeoutMs = options.timeoutMs || FETCH_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const requestImpl = options.requestImpl || requestToFile;

  async function download(rawUrl, filename) {
    await uploadStore.initialize();
    let current = safeRemoteUrl(rawUrl);
    const entryDirectory = join(uploadStore.directory, `remote-${randomUUID()}`);
    const candidateFilename = filename || basename(current.pathname) || 'download.bin';
    const cleanedFilename = candidateFilename.replace(/[\r\n"\\/]/g, '_');
    const resolvedFilename = !cleanedFilename || cleanedFilename === '.' || cleanedFilename === '..'
      ? 'download.bin'
      : cleanedFilename;
    const filePath = join(entryDirectory, resolvedFilename);
    await mkdir(entryDirectory, { mode: 0o700 });

    try {
      for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        const addresses = await allowedAddresses(current.hostname, lookupImpl);
        const result = await requestImpl(current, filePath, {
          addresses,
          timeoutMs,
          maxBytes: uploadStore.maxBytes,
          reserveBytes: uploadStore.reserveBytes,
          releaseBytes: uploadStore.releaseBytes,
        });
        if (!result.redirect) {
          return {
            filePath,
            filename: resolvedFilename,
            mimeType: result.mimeType,
            cleanup: async () => {
              uploadStore.releaseBytes(result.reservedBytes || 0);
              await rm(entryDirectory, { recursive: true, force: true });
            },
          };
        }
        await rm(filePath, { force: true });
        current = safeRemoteUrl(result.redirect);
      }
      throw codedError('REMOTE_SOURCE_FETCH_FAILED', 'Remote source exceeded redirect limit');
    } catch (error) {
      await rm(entryDirectory, { recursive: true, force: true });
      if (error?.code?.startsWith('REMOTE_SOURCE_') || error?.code === 'UPLOAD_QUOTA_EXCEEDED') throw error;
      throw codedError('REMOTE_SOURCE_FETCH_FAILED', 'Remote source download failed');
    }
  }

  async function resolve(source) {
    if (source?.uploadId) {
      const entry = await uploadStore.acquire(source.uploadId);
      return { ...entry, cleanup: entry.release };
    }
    if (source?.url) return download(source.url, source.filename);
    throw codedError('INVALID_FILE_SOURCE', 'File source must contain uploadId or url');
  }

  return { resolve };
}
