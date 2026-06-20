const DEFAULT_REFRESH_SKEW_SECONDS = 300;

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isConfigured(appId, appSecret) {
  return typeof appId === 'string' && appId.length > 0
    && typeof appSecret === 'string' && appSecret.length > 0;
}

function tokenUrl(appId, appSecret) {
  const params = new URLSearchParams({
    grant_type: 'client_credential',
    appid: appId,
    secret: appSecret,
  });
  return `https://api.weixin.qq.com/cgi-bin/token?${params.toString()}`;
}

export function createWechatTokenManager({
  appId = process.env.WEMP_WECHAT_APP_ID || '',
  appSecret = process.env.WEMP_WECHAT_APP_SECRET || '',
  refreshSkewSeconds = Number(process.env.WEMP_WECHAT_TOKEN_REFRESH_SKEW_SECONDS || DEFAULT_REFRESH_SKEW_SECONDS),
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  let cachedToken = '';
  let expiresAt = 0;
  let refreshInFlight = null;

  function ensureConfigured() {
    if (!isConfigured(appId, appSecret)) {
      throw createError(
        'WECHAT_SERVER_AUTH_NOT_CONFIGURED',
        'WEMP_WECHAT_APP_ID and WEMP_WECHAT_APP_SECRET are required for WeChat MCP tools',
      );
    }
  }

  function isUsableCachedToken() {
    return cachedToken && expiresAt > now();
  }

  async function refreshAccessToken() {
    ensureConfigured();
    const response = await fetchImpl(tokenUrl(appId, appSecret));
    const data = await response.json();
    if (data.errcode) {
      throw createError('WECHAT_TOKEN_REFRESH_FAILED', `获取微信 access_token 失败: ${data.errcode} - ${data.errmsg}`);
    }
    if (!data.access_token) {
      throw createError('WECHAT_TOKEN_REFRESH_FAILED', '微信 access_token 响应缺少 access_token');
    }

    const expiresIn = Number(data.expires_in || 7200);
    const skewMs = Math.max(Number(refreshSkewSeconds) || DEFAULT_REFRESH_SKEW_SECONDS, 0) * 1000;
    cachedToken = data.access_token;
    expiresAt = now() + Math.max(expiresIn * 1000 - skewMs, 0);
    return cachedToken;
  }

  async function getAccessToken({ forceRefresh = false } = {}) {
    if (!forceRefresh && isUsableCachedToken()) return cachedToken;

    if (!refreshInFlight) {
      refreshInFlight = refreshAccessToken().finally(() => {
        refreshInFlight = null;
      });
    }

    return refreshInFlight;
  }

  function getRedactionSecrets() {
    return [
      appSecret,
      appSecret ? encodeURIComponent(appSecret) : '',
      cachedToken,
      cachedToken ? encodeURIComponent(cachedToken) : '',
    ].filter(Boolean);
  }

  return {
    fetchImpl,
    getAccessToken,
    getRedactionSecrets,
  };
}
