// 搜索协调层：管理搜索引擎实例、结果格式化

import type { WebSearchProvider, SearchParams, SearchResult, PageContent } from './webSearch/WebSearchProvider.js';
import { IqsSearchProvider } from './webSearch/IqsSearchProvider.js';
import { config } from '../config.js';

export class WebSearchService {
  private provider: WebSearchProvider | null = null;

  /** 根据 IQS API Key 初始化搜索引擎 */
  initFromConfig(apiKey?: string): void {
    const key = apiKey || config.iqsApiKey;
    if (key) {
      this.provider = new IqsSearchProvider(key, config.iqsBaseUrl);
      console.log('[WebSearch] IQS 搜索引擎已初始化');
    } else {
      this.provider = null;
      console.log('[WebSearch] IQS API Key 未配置，搜索引擎不可用');
    }
  }

  /** 重建 provider（API Key 变更后调用） */
  setProvider(provider: WebSearchProvider): void {
    this.provider = provider;
  }

  getProvider(): WebSearchProvider | null {
    return this.provider;
  }

  isAvailable(): boolean {
    return this.provider !== null;
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    if (!this.provider) throw new Error('搜索引擎未配置，请在设置中填写 IQS API Key');
    return this.provider.search(params);
  }

  async fetchPage(url: string, mode: 'basic' | 'scrape' = 'basic'): Promise<PageContent> {
    if (!this.provider) throw new Error('搜索引擎未配置，请在设置中填写 IQS API Key');
    return this.provider.fetchPage(url, mode);
  }
}

export const webSearchService = new WebSearchService();
