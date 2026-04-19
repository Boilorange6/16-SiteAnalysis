import type { RegionMetadata } from "./types";

export interface RegionSearchSuggestion {
  readonly region: RegionMetadata;
  readonly title: string;
  readonly subtitle: string;
  readonly matchedText: string;
  readonly score: number;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function getMatchScore(source: string, query: string, baseScore: number): number {
  const normalizedSource = normalize(source);
  if (normalizedSource === query) {
    return baseScore + 50;
  }

  if (normalizedSource.startsWith(query)) {
    return baseScore + 30;
  }

  if (normalizedSource.includes(query)) {
    return baseScore + 10;
  }

  return 0;
}

export function getRegionSearchSuggestions(
  regions: readonly RegionMetadata[],
  query: string,
  limit = 5
): readonly RegionSearchSuggestion[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return regions.slice(0, limit).map((region) => ({
      region,
      title: region.defaultConfig.centerName,
      subtitle: region.address,
      matchedText: region.regionName,
      score: 1,
    }));
  }

  const normalizedQuery = normalize(trimmedQuery);

  return regions
    .map((region) => {
      const searchFields = [
        { text: region.address, baseScore: 110 },
        { text: region.regionName, baseScore: 100 },
        { text: region.defaultConfig.centerName, baseScore: 95 },
        ...region.aliases.map((alias) => ({ text: alias, baseScore: 80 })),
      ];

      let bestScore = 0;
      let matchedText = region.regionName;

      searchFields.forEach((field) => {
        const score = getMatchScore(field.text, normalizedQuery, field.baseScore);
        if (score > bestScore) {
          bestScore = score;
          matchedText = field.text;
        }
      });

      if (bestScore === 0) {
        return null;
      }

      return {
        region,
        title: region.defaultConfig.centerName,
        subtitle: region.address,
        matchedText,
        score: bestScore,
      };
    })
    .filter((suggestion): suggestion is RegionSearchSuggestion => suggestion !== null)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "ko"))
    .slice(0, limit);
}
