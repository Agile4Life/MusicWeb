export type SearchLane = 'global' | 'suggestion' | 'trending';

export interface SearchRequests {
  issue(lane: SearchLane): number;
  isCurrent(lane: SearchLane, token: number): boolean;
  invalidate(lane: SearchLane): void;
  invalidateAll(): void;
}

export function createSearchRequests(): SearchRequests {
  const tokens: Record<SearchLane, number> = {
    global: 0,
    suggestion: 0,
    trending: 0,
  };

  return {
    issue(lane: SearchLane): number {
      tokens[lane] += 1;
      return tokens[lane];
    },
    isCurrent(lane: SearchLane, token: number): boolean {
      return tokens[lane] === token;
    },
    invalidate(lane: SearchLane): void {
      tokens[lane] += 1;
    },
    invalidateAll(): void {
      tokens.global += 1;
      tokens.suggestion += 1;
      tokens.trending += 1;
    },
  };
}
