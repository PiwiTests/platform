import { describe, test, expect } from 'vitest';
import { cosineSimilarity, parseEmbedding } from '../../server/utils/cluster-similarity';

describe('cluster-similarity', () => {
  test('identical vectors have cosine 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  test('orthogonal vectors have cosine 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  test('opposite vectors have cosine -1', () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 6);
  });

  test('similar vectors score high, dissimilar low', () => {
    const a = [0.9, 0.1, 0.05];
    const near = [0.88, 0.12, 0.06];
    const far = [0.1, 0.9, 0.8];
    expect(cosineSimilarity(a, near)).toBeGreaterThan(0.99);
    expect(cosineSimilarity(a, far)).toBeLessThan(0.5);
  });

  test('mismatched lengths and zero vectors return 0', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  test('parseEmbedding round-trips a JSON number array', () => {
    expect(parseEmbedding(JSON.stringify([1, 2.5, -3]))).toEqual([1, 2.5, -3]);
  });

  test('parseEmbedding rejects null, non-arrays, and non-numeric arrays', () => {
    expect(parseEmbedding(null)).toBeNull();
    expect(parseEmbedding('not json')).toBeNull();
    expect(parseEmbedding('{"a":1}')).toBeNull();
    expect(parseEmbedding('["a","b"]')).toBeNull();
  });
});
