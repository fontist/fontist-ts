import type { FormulaRepository } from './formulaRepository.js';

const STOP_WORDS = ['macos', 'sil', 'google', 'windows', 'private'];
const MIN_SCORE = 0.6;
const MAX_SUGGESTIONS = 10;

/** Dice-coefficient + Levenshtein fuzzy matching over formula keys, used to
 * suggest alternatives when an exact formula name is not found. */
export class FormulaSuggestion {
  constructor(private readonly repository: FormulaRepository) {}

  async find(name: string): Promise<string[]> {
    const keys = await this.repository.allKeys();
    const query = normalize(name);
    const scored: { key: string; score: number }[] = [];
    for (const key of keys) {
      const normalized = normalize(stripStopWords(key));
      const score = Math.max(diceCoefficient(query, normalized), levenshteinScore(query, normalized));
      if (score >= MIN_SCORE) {
        scored.push({ key, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const topKeys = scored.slice(0, MAX_SUGGESTIONS).map((s) => s.key);
    const result: string[] = [];
    for (const key of topKeys) {
      const formula = await this.repository.findByKeyOrName(key);
      if (formula?.isDownloadable()) result.push(key);
    }
    return result;
  }
}

function stripStopWords(key: string): string {
  const parts = key.split('/');
  if (parts.length > 1 && STOP_WORDS.includes(parts[0]!)) {
    parts.shift();
  }
  return parts.join('/');
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/ /g, '_');
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < value.length - 1; i++) {
    result.add(value.slice(i, i + 2));
  }
  return result;
}

function diceCoefficient(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  let intersection = 0;
  for (const gram of bigramsA) {
    if (bigramsB.has(gram)) intersection += 1;
  }
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

function levenshteinScore(a: string, b: string): number {
  const distance = levenshteinDistance(a, b);
  return 1 - distance / Math.max(a.length, b.length, 1);
}

function levenshteinDistance(a: string, b: string): number {
  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) previous[j] = current[j]!;
  }
  return previous[b.length]!;
}
