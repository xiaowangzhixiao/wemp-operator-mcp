import * as utils from '../scripts/lib/utils.mjs';

function orderedArguments(tool, args) {
  return tool.params.map((definition) => args[definition.name]);
}

export async function invokeWechatApiTool(tool, args, tokenManager, fileSourceResolver) {
  const handler = utils[tool.handler];
  if (typeof handler !== 'function') {
    throw new Error(`No handler exported for ${tool.handler}`);
  }

  const execute = async (resolvedArgs) => {
    const call = () => handler(...orderedArguments(tool, resolvedArgs));
    if (!tool.requiresWechatAuth) return call();
    return utils.runWithWechatAuth({
      getAccessToken: tokenManager?.getAccessToken,
      fetchImpl: tokenManager?.fetchImpl,
      forbidLocalConfig: true,
    }, call);
  };

  if (!tool.fileSourceParam) return execute(args);
  if (!fileSourceResolver) throw Object.assign(new Error('File source resolver is unavailable'), { code: 'INVALID_FILE_SOURCE' });
  const resolved = await fileSourceResolver.resolve(args[tool.fileSourceParam]);
  try {
    return await execute({ ...args, [tool.fileSourceParam]: resolved.filePath });
  } finally {
    await resolved.cleanup();
  }
}
