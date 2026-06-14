import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(zlib.gzip);

export async function compressDirectory(sourceDir: string): Promise<Buffer> {
  const files: Array<{ path: string; content: Buffer }> = [];

  function collect(dir: string, baseDir = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.join(baseDir, entry.name);
      if (entry.isDirectory()) collect(full, rel);
      else if (entry.isFile()) files.push({ path: rel, content: fs.readFileSync(full) });
    }
  }

  collect(sourceDir);

  const parts: Buffer[] = [];
  for (const f of files) {
    const pb = Buffer.from(f.path, 'utf8');
    const plb = Buffer.allocUnsafe(4);
    plb.writeUInt32LE(pb.length, 0);
    const clb = Buffer.allocUnsafe(4);
    clb.writeUInt32LE(f.content.length, 0);
    parts.push(plb, pb, clb, f.content);
  }

  return await gzipAsync(Buffer.concat(parts), { level: 5 });
}
