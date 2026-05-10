// 阿里云 IQS（信息查询服务）搜索引擎实现
// API 文档: https://help.aliyun.com/document_detail/2809724.html

import type { WebSearchProvider, SearchParams, SearchResult, PageContent } from './WebSearchProvider.js';

export class IqsSearchProvider implements WebSearchProvider {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://cloud-iqs.aliyuncs.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    const resp = await fetch(`${this.baseUrl}/search/unified`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: params.query,
        engineType: 'LiteAdvanced',
        timeRange: params.timeRange || 'NoLimit',
        contents: {
          mainText: false,
          markdownText: false,
          summary: true,
          rerankScore: true,
        },
        advancedParams: { numResults: params.maxResults || 5 },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`IQS 搜索请求失败 (${resp.status}): ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    return (data.pageItems || []).map((item: any) => ({
      title: item.title || '',
      url: item.link || '',
      snippet: item.snippet || '',
      summary: item.summary || undefined,
      publishedTime: item.publishedTime || undefined,
      rerankScore: item.rerankScore ?? undefined,
      hostname: item.hostname || undefined,
      hostLogo: item.hostLogo || undefined,
    }));
  }

  async fetchPage(url: string, mode: 'basic' | 'scrape'): Promise<PageContent> {
    const endpoint = mode === 'scrape' ? '/readpage/scrape' : '/readpage/basic';
    const resp = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, maxAge: 0 }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`IQS 页面抓取失败 (${resp.status}): ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const html = data.data?.html || '';
    const text = this.extractText(html);
    const title = this.extractTitle(html) || url;

    return {
      url,
      title,
      content: text.slice(0, 5000),
      fetchedAt: new Date().toISOString(),
    };
  }

  // 简单 HTML 清洗：移除标签、脚本、样式，保留纯文本
  private extractText(html: string): string {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? match[1].trim() : '';
  }
}
