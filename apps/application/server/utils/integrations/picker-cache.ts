/**
 * Five-minute caches for the modal's Jira pickers, so opening the create modal a
 * few times does not hammer Jira with the same project / issue-type / assignable
 * lookups. Keyed by connection id and the query, shared across requests.
 */
import { TtlCache } from '../ttl-cache';
import type { TrackerIssueType, TrackerProject, TrackerUser } from './types';

const TTL_MS = 5 * 60 * 1000;

export const projectsCache = new TtlCache<TrackerProject[]>(TTL_MS);
export const issueTypesCache = new TtlCache<TrackerIssueType[]>(TTL_MS);
export const assignableCache = new TtlCache<TrackerUser[]>(TTL_MS);
