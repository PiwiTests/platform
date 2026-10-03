// Types for the parts of build.mjs the tests import.
export function chromiumManifest<T extends { background?: Record<string, unknown> }>(manifest: T): T;
export function firefoxManifest<T extends { permissions?: string[] }>(manifest: T): T;
export function buildExtension(options?: { release?: boolean; pseudo?: boolean }): Promise<void>;
export function isReleaseBuild(dir: string, version: string): boolean;
export const IDE_CHROME_GLOBAL: string;
export function buildIdeBundle(options: { outDir: string; release?: boolean }): Promise<void>;
