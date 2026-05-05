// API URL 缓存：记住各 provider + endpoint 最近验证成功的 URL
// 避免每次调用都 fallback 重试，进程重启自动清空

const cache = new Map<string, { url: string; time: number }>();

function normalizeBase(baseUrl: string): string {
  return String(baseUrl).replace(/\/+$/, '').replace(/\/v\d+$/, '');
}

function cacheKey(providerId: string, endpoint: string): string {
  return `${providerId}:${endpoint}`;
}

/**
 * 获取首选 URL：有缓存返回缓存，无缓存返回标准 /v1/{endpoint}
 */
export function getPreferredUrl(providerId: string, endpoint: string, baseUrl: string): string {
  const cached = cache.get(cacheKey(providerId, endpoint));
  if (cached && Date.now() - cached.time < 30 * 60 * 1000) {
    return cached.url;
  }
  return `${normalizeBase(baseUrl)}/v1/${endpoint}`;
}

/**
 * 标记 URL 成功，缓存供后续使用
 */
export function markSuccess(providerId: string, endpoint: string, url: string): void {
  cache.set(cacheKey(providerId, endpoint), { url, time: Date.now() });
}

/**
 * 获取备选 URL：不带 /v1 的路径
 */
export function getFallbackUrl(providerId: string, endpoint: string, baseUrl: string): string {
  return `${normalizeBase(baseUrl)}/${endpoint}`;
}
