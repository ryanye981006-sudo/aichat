// 搜索引擎接口抽象：统一不同搜索引擎的调用方式

export interface SearchParams {
  query: string;
  maxResults?: number;      // 默认 5，最大 10
  timeRange?: 'NoLimit' | 'OneDay' | 'OneWeek' | 'OneMonth' | 'OneYear';
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  summary?: string;
  publishedTime?: string;
  rerankScore?: number;
  hostname?: string;
  hostLogo?: string;          // 网站图标 URL（IQS API 实测返回）
}

export interface PageContent {
  url: string;
  title: string;
  content: string;           // 清洗后的纯文本
  fetchedAt: string;
}

export interface WebSearchProvider {
  /** 搜索互联网，返回结果列表 */
  search(params: SearchParams): Promise<SearchResult[]>;
  /** 抓取指定网页的全文内容 */
  fetchPage(url: string, mode: 'basic' | 'scrape'): Promise<PageContent>;
}
