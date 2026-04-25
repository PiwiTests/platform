const fs = require('fs');
const path = require('path');
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
    console.warn(`[Playwright Dashboard] Failed to compress report directory ${reportDir}: ${error.message}`);
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

  // Look in attachments for trace files
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
 * Default report directory guesses for known report types
 * @type {Object<string, string>}
 */
const DEFAULT_REPORT_DIRS = {
  html: 'playwright-report',
  monocart: 'monocart-report',
  allure: 'allure-results',
  blob: 'blob-report'
};

module.exports = {
  findHTMLReportDirectory,
  findReportDirectory,
  compressReportDirectory,
  findTraceFiles,
  DEFAULT_REPORT_DIRS
};
