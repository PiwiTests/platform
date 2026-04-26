const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzipAsync = promisify(zlib.gzip);

/**
 * Compress a directory using gzip compression
 * Creates a tar-like structure in memory and compresses with gzip
 * @param {string} sourceDir - Directory to compress
 * @returns {Promise<Buffer>} - Compressed buffer
 */
async function compressDirectory(sourceDir) {
  // Create a simple archive format in memory
  const files = [];

  // Recursively collect all files
  function collectFiles(dir, baseDir = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(baseDir, entry.name);

      if (entry.isDirectory()) {
        collectFiles(fullPath, relativePath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(fullPath);
        files.push({
          path: relativePath,
          size: content.length,
          content: content
        });
      }
    }
  }

  collectFiles(sourceDir);

  // Create a simple archive format (little-endian byte order):
  // For each file: [path_length (4 bytes LE)][path (UTF-8)][content_length (4 bytes LE)][content]
  const parts = [];

  for (const file of files) {
    const pathBuffer = Buffer.from(file.path, 'utf8');
    const pathLengthBuffer = Buffer.allocUnsafe(4);
    pathLengthBuffer.writeUInt32LE(pathBuffer.length, 0);

    const contentLengthBuffer = Buffer.allocUnsafe(4);
    contentLengthBuffer.writeUInt32LE(file.content.length, 0);

    parts.push(pathLengthBuffer, pathBuffer, contentLengthBuffer, file.content);
  }

  const uncompressed = Buffer.concat(parts);

  // Compress with gzip at a reasonable level (5) for a good balance of speed and compression ratio
  return await gzipAsync(uncompressed, { level: 5 });
}

module.exports = {
  compressDirectory,
};
