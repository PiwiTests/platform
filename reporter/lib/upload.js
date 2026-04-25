const https = require('https');
const http = require('http');
const { URL } = require('url');
const FormData = require('form-data');

/**
 * Make an HTTP/HTTPS POST request with JSON body
 * @param {string} serverUrl - Base server URL
 * @param {string} pathname - API path
 * @param {Object} payload - JSON payload
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<Object>} Parsed response body
 */
function postJSON(serverUrl, pathname, payload, verbose) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, serverUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const postData = JSON.stringify(payload);

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = lib.request(reqOptions, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({});
          }
        } else {
          if (verbose) {
            console.error(`[Playwright Dashboard] Response: ${data}`);
          }
          reject(new Error(`Request failed with status ${res.statusCode}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Make an HTTP/HTTPS POST request with multipart form data
 * @param {string} serverUrl - Base server URL
 * @param {string} pathname - API path
 * @param {FormData} form - FormData instance
 * @returns {Promise<Object>} Parsed response body
 */
function postFormData(serverUrl, pathname, form) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, serverUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: form.getHeaders()
    };

    const req = lib.request(reqOptions, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({});
          }
        } else {
          reject(new Error(`Request failed with status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    form.pipe(req);
  });
}

module.exports = { postJSON, postFormData, FormData };
