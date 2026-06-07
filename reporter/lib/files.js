const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { compressDirectory } = require('../compression');

/**
 * Find the Playwright HTML report directory
 * @param {string} [customDir] - Optional custom directory path from options
 * @returns {string|null} Path to the HTML report directory or null
 */
function findHTMLReportDirectory(customDir) {
  const possibleDirs = customDir
    ? [customDir, path.join(process.cwd(), customDir)]
    : [
        'playwright-report',
        './playwright-report',
        path.join(process.cwd(), 'playwright-report')
      ];

  for (const reportDir of possibleDirs) {
    if (fs.existsSync(reportDir) && fs.statSync(reportDir).isDirectory()) {
      // Verify it contains index.html
      const indexPath = path.join(reportDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        return reportDir;
      }
    }
  }

  return null;
}

/**
 * Find a generic report directory (for monocart, allure, blob, etc.)
 * The directory must exist (index.html presence is not required for all report types).
 * @param {string} dir - Directory path to check
 * @returns {string|null} Path to the directory or null if not found
 */
function findReportDirectory(dir) {
  const candidates = [dir, path.join(process.cwd(), dir)];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

/**
 * Compress a report directory into a buffer
 * @param {string} reportDir - Path to the directory
 * @returns {Promise<Buffer|null>} Compressed buffer or null on failure
 */
async function compressReportDirectory(reportDir) {
  try {
    const compressed = await compressDirectory(reportDir);
    return compressed || null;
  } catch (error) {
    console.warn(`[Piwi Dashboard] Failed to compress report directory ${reportDir}: ${error.message}`);
    return null;
  }
}

/**
 * Find trace files for a test case from its attachments
 * @param {Object} testCase - Test case object with attachments
 * @returns {string[]} Array of absolute trace file paths
 */
function findTraceFiles(testCase) {
  const traceFilesSet = new Set();

  if (testCase.attachments && testCase.attachments.length > 0) {
    for (const attachment of testCase.attachments) {
      if (attachment.name === 'trace' && attachment.path) {
        const normalizedPath = path.resolve(attachment.path);
        traceFilesSet.add(normalizedPath);
      }
    }
  }

  return Array.from(traceFilesSet);
}

/**
 * Find all non-trace file attachments for a test case.
 * Returns each attachment with its metadata and resolved path.
 *
 * @param {Object} testCase - Test case object with attachments
 * @returns {Object[]} Array of { name, path, contentType, originalName }
 */
function findAllAttachments(testCase) {
  const result = [];

  if (testCase.attachments && testCase.attachments.length > 0) {
    for (const attachment of testCase.attachments) {
      if (attachment.name === 'trace') continue
      if (attachment.name?.startsWith('piwi-dashboard-')) continue
      if (attachment.path && fs.existsSync(attachment.path)) {
        result.push({
          name: attachment.name || 'attachment',
          path: path.resolve(attachment.path),
          contentType: attachment.contentType || 'application/octet-stream',
          originalName: path.basename(attachment.path)
        });
      }
    }
  }

  return result;
}

/**
 * Default report directory guesses for known report types
 * @type {Object<string, string>}
 */
const DEFAULT_REPORT_DIRS = {
  html: 'playwright-report',
  monocart: 'monocart-report',
  allure: 'allure-report',
  blob: 'blob-report'
};

/**
 * Compute SHA-256 hashes for all trace files, indexed by test case position.
 * Mirrors the index semantics of trace_N form fields and _appendTracesToForm:
 * when a test case has multiple trace attachments the last valid path wins,
 * matching FormData's last-write-wins behaviour for duplicate field names.
 *
 * Uses streaming reads to avoid loading large files into memory.
 *
 * @param {Object[]} testCases - Array of test case objects with attachments
 * @returns {Promise<Map<number, { tracePath: string, hash: string, size: number }>>}
 */
async function computeTraceHashes(testCases) {
  const result = new Map();

  for (let i = 0; i < testCases.length; i++) {
    const tracePaths = findTraceFiles(testCases[i]);
    let lastPath = null;
    for (const tracePath of tracePaths) {
      if (fs.existsSync(tracePath)) {
        lastPath = tracePath;
      }
    }
    if (!lastPath) continue;

    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => {
      fs.createReadStream(lastPath)
        .on('data', (chunk) => hash.update(chunk))
        .on('end', resolve)
        .on('error', reject)
    });
    result.set(i, { tracePath: lastPath, hash: hash.digest('hex'), size: fs.statSync(lastPath).size });
  }

  return result;
}

module.exports = {
  findHTMLReportDirectory,
  findReportDirectory,
  compressReportDirectory,
  findTraceFiles,
  findAllAttachments,
  computeTraceHashes,
  DEFAULT_REPORT_DIRS
};
