/**
 * Commit-message trailers: the `Key: value` lines git appends after the body
 * (`Co-authored-by:`, `Signed-off-by:`). Piwi writes its own on the commits it
 * makes (`Piwi-Heal: <dedupe key>`) and reads them back from the commits a fix
 * landed with.
 *
 * A trailer is read from any paragraph after the subject whose every line is
 * `Key: value`, not only the last one: a squash merge lists each squashed
 * commit's message, so a trailer can end up in a middle paragraph.
 */

/** The trailer auto-heal writes on its commits, holding the heal action's dedupe key. */
export const HEAL_COMMIT_TRAILER = 'Piwi-Heal';

/** One trailer line. */
export interface CommitTrailer {
  key: string;
  value: string;
}

const TRAILER_LINE = /^([A-Za-z0-9][A-Za-z0-9-]*):[ \t]*(\S.*?)\s*$/;

/** Every trailer of a commit message, in order. */
export function readCommitTrailers(message: string | null | undefined): CommitTrailer[] {
  if (!message) return [];
  const paragraphs = message.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/);
  const trailers: CommitTrailer[] = [];
  for (const paragraph of paragraphs.slice(1)) {
    const lines = paragraph.split('\n').filter((line) => line.trim());
    if (lines.length === 0) continue;
    const parsed = lines.map((line) => TRAILER_LINE.exec(line.trim()));
    if (parsed.some((match) => !match)) continue;
    for (const match of parsed) trailers.push({ key: match![1]!, value: match![2]! });
  }
  return trailers;
}

/** The values of one trailer key in a commit message, matched case-insensitively. */
export function trailerValues(message: string | null | undefined, key: string): string[] {
  const wanted = key.toLowerCase();
  return readCommitTrailers(message)
    .filter((trailer) => trailer.key.toLowerCase() === wanted)
    .map((trailer) => trailer.value);
}
