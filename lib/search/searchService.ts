import { fetchUnifiedSearch, GlobalSearchTracks } from '@/lib/searchApi';

export interface SearchService {
  searchGlobal(query: string): Promise<GlobalSearchTracks>;
  searchSuggestions(query: string): Promise<GlobalSearchTracks>;
  loadTrending(): Promise<GlobalSearchTracks>;
}

export function createSearchService(
  fetchSearch: typeof fetchUnifiedSearch = fetchUnifiedSearch
): SearchService {
  return {
    searchGlobal: (query) => fetchSearch(query, 'all', false),
    searchSuggestions: (query) => fetchSearch(query, 'all', false),
    loadTrending: () => fetchSearch('', 'all', true),
  };
}
