import { describe, expect, test } from 'vitest';
import { clusterIdsFromCommitMessage, clusterTrailerLine } from '#shared/commit-trailers';

describe('the Piwi-Cluster trailer', () => {
  test('reads the cluster ids a commit names, in several trailers or one list', () => {
    expect(clusterIdsFromCommitMessage('Fix\n\nPiwi-Cluster: 3, #4\nPiwi-Cluster: 4 9')).toEqual([3, 4, 9]);
    expect(clusterIdsFromCommitMessage('Fix\r\n\r\npiwi-cluster: 12')).toEqual([12]);
    expect(clusterIdsFromCommitMessage('Fix\n\nPiwi-Cluster: x')).toEqual([]);
  });

  test('never reads the subject line or a paragraph of prose', () => {
    expect(clusterIdsFromCommitMessage('Piwi-Cluster: 3')).toEqual([]);
    expect(clusterIdsFromCommitMessage('Fix\n\nThis fixes Piwi-Cluster: 3 for good.\nSee: the ticket')).toEqual([]);
    expect(clusterIdsFromCommitMessage(null)).toEqual([]);
  });

  test('reads it from a squash merge, beside a Piwi-Heal trailer', () => {
    const message = 'fix: cart (#12)\n\n* fix: total\n\nPiwi-Cluster: 214\n\n* chore: tidy\n\nPiwi-Heal: heal:v1:3:k';
    expect(clusterIdsFromCommitMessage(message)).toEqual([214]);
  });

  test('suggests the trailer line for a cluster', () => {
    expect(clusterTrailerLine(214)).toBe('Piwi-Cluster: 214');
    expect(clusterIdsFromCommitMessage(`Fix the cart\n\n${clusterTrailerLine(214)}`)).toEqual([214]);
  });
});
