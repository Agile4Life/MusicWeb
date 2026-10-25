import { describe, expect, it, vi } from 'vitest';
import { createSearchRequests } from '@/lib/search/searchRequests';
import { createSearchService } from '@/lib/search/searchService';
import type { GlobalSearchTracks } from '@/lib/searchApi';

const emptyResults: GlobalSearchTracks = {
  nhaccuatui: [],
  local: [],
  youtube: [],
  spotify: [],
  deezer: [],
  soundcloud: [],
};

describe('searchRequests and searchService', () => {
  it('invalidates older tokens per lane without affecting other lanes', () => {
    const requests = createSearchRequests();
    const global1 = requests.issue('global');
    const suggestion1 = requests.issue('suggestion');
    const global2 = requests.issue('global');

    expect(requests.isCurrent('global', global1)).toBe(false);
    expect(requests.isCurrent('global', global2)).toBe(true);
    expect(requests.isCurrent('suggestion', suggestion1)).toBe(true);

    requests.invalidate('suggestion');
    expect(requests.isCurrent('suggestion', suggestion1)).toBe(false);
    expect(requests.isCurrent('global', global2)).toBe(true);
  });

  it('invalidates all lanes when invalidateAll is called', () => {
    const requests = createSearchRequests();
    const g = requests.issue('global');
    const s = requests.issue('suggestion');
    const t = requests.issue('trending');

    requests.invalidateAll();

    expect(requests.isCurrent('global', g)).toBe(false);
    expect(requests.isCurrent('suggestion', s)).toBe(false);
    expect(requests.isCurrent('trending', t)).toBe(false);
  });

  it('delegates global, suggestion, and trending calls to injected fetchSearch', async () => {
    const fetchSearch = vi.fn().mockResolvedValue(emptyResults);
    const service = createSearchService(fetchSearch);

    await service.searchGlobal('son tung');
    await service.searchSuggestions('son');
    await service.loadTrending();

    expect(fetchSearch).toHaveBeenNthCalledWith(1, 'son tung', 'all', false);
    expect(fetchSearch).toHaveBeenNthCalledWith(2, 'son', 'all', false);
    expect(fetchSearch).toHaveBeenNthCalledWith(3, '', 'all', true);
  });
});
