import { createSearchService, SearchService } from '@/lib/search/searchService';

export function createBrowserSearchService(): SearchService {
  return createSearchService();
}
