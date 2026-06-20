import Busboy from 'busboy';

function errorStatus(code) {
  if (code === 'FILE_TOO_LARGE') return 413;
  if (code === 'UPLOAD_QUOTA_EXCEEDED') return 507;
  return 400;
}

function errorMessage(code, uploadStore) {
  if (code === 'FILE_TOO_LARGE') return `File exceeds ${uploadStore.maxBytes} byte limit`;
  if (code === 'UPLOAD_QUOTA_EXCEEDED') return 'Temporary upload quota exceeded';
  return 'Exactly one file field is required';
}

export function createUploadHandler(uploadStore) {
  return (req, res) => {
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 2, fileSize: uploadStore.maxBytes, fields: 0 },
      });
    } catch {
      res.status(400).json({ error: { code: 'INVALID_FILE_SOURCE', message: 'Expected multipart/form-data with one file field' } });
      return;
    }

    let fileCount = 0;
    let pending;
    let uploaded;
    let failure;
    parser.on('file', (fieldName, stream, info) => {
      fileCount += 1;
      if (fieldName !== 'file' || fileCount > 1) {
        stream.resume();
        failure = Object.assign(new Error('Exactly one file field is required'), { code: 'INVALID_FILE_SOURCE' });
        return;
      }
      stream.on('limit', () => {
        failure = Object.assign(new Error(`File exceeds ${uploadStore.maxBytes} byte limit`), { code: 'FILE_TOO_LARGE' });
      });
      pending = uploadStore.saveStream(stream, {
        filename: info.filename,
        mimeType: info.mimeType,
      }).then((result) => {
        uploaded = result;
      }).catch((error) => {
        failure = error;
      });
    });
    parser.on('error', (error) => {
      failure = error;
    });
    parser.on('field', () => {
      failure = Object.assign(new Error('Unexpected form field'), { code: 'INVALID_FILE_SOURCE' });
    });
    parser.on('fieldsLimit', () => {
      failure = Object.assign(new Error('Unexpected form field'), { code: 'INVALID_FILE_SOURCE' });
    });
    parser.on('finish', async () => {
      await pending;
      if (!failure && fileCount === 1 && uploaded) {
        const result = await uploadStore.resolve(uploaded.uploadId).catch(() => null);
        if (result) {
          res.status(201).json({
            uploadId: result.uploadId,
            filename: result.filename,
            mimeType: result.mimeType,
            size: result.size,
            expiresAt: new Date(result.expiresAtMs).toISOString(),
          });
          return;
        }
      }
      if (uploaded?.uploadId) await uploadStore.removeEntry(uploaded.uploadId);
      const code = failure?.code || 'INVALID_FILE_SOURCE';
      res.status(errorStatus(code)).json({ error: { code, message: errorMessage(code, uploadStore) } });
    });
    req.pipe(parser);
  };
}
