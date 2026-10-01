/**
 * Type declarations for the resource finding identity. See `resource-fingerprint.mjs`.
 */
import type { WireResourceFinding } from '@piwitests/core/wire';

export declare function withoutLines(text: string | null | undefined): string;
export declare function resourceFingerprint(finding: WireResourceFinding): string;
export declare function isLeak(finding: Pick<WireResourceFinding, 'verdict'>): boolean;
