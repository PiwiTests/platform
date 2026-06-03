const https = require('https');
const http = require('http');
const { URL } = require('url');
const FormData = require('form-data');

/**
 * Log in to the dashboard and return the session cookie string.
 * @param {string} serverUrl - Base server URL
 * @param {string} username - Username
 * @param {string} password - Password
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<string>} Session cookie header value
 */
function loginUser(serverUrl, username, password, verbose) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/auth/login', serverUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const postData = JSON.stringify({ username, password });

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
          const setCookie = res.headers['set-cookie'];
          if (!setCookie || setCookie.length === 0) {
            reject(new Error('Login succeeded but no session cookie was returned'));
            return;
          }
          // Nuxt may set multiple cookies (session + CSRF); join them all into one Cookie header
          const cookie = setCookie.map(c => c.split(';')[0]).join('; ');
          if (verbose) {
            console.log('[Piwi Dashboard] Logged in successfully');
          }
          resolve(cookie);
        } else {
          if (verbose) {
            console.error(`[Piwi Dashboard] Login response: ${data}`);
          }
          reject(new Error(`Login failed with status ${res.statusCode}`));
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
 * Make an HTTP/HTTPS POST request with JSON body
 * @param {string} serverUrl - Base server URL
 * @param {string} pathname - API path
 * @param {Object} payload - JSON payload
 * @param {boolean} verbose - Whether to log verbose output
 * @param {string} [cookieOrApiKey] - Optional session cookie or API key (Bearer) to include
 * @returns {Promise<Object>} Parsed response body
 */
function postJSON(serverUrl, pathname, payload, verbose, cookieOrApiKey) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, serverUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const postData = JSON.stringify(payload);

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    };

    if (cookieOrApiKey) {
      if (cookieOrApiKey.startsWith('pd_')) {
        headers['Authorization'] = `Bearer ${cookieOrApiKey}`;
      } else {
        headers['Cookie'] = cookieOrApiKey;
      }
    }

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers
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
            console.error(`[Piwi Dashboard] Response: ${data}`);
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
 * @param {string} [cookieOrApiKey] - Optional session cookie or API key (Bearer) to include
 * @returns {Promise<Object>} Parsed response body
 */
function postFormData(serverUrl, pathname, form, cookieOrApiKey) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, serverUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers = form.getHeaders();
    if (cookieOrApiKey) {
      if (cookieOrApiKey.startsWith('pd_')) {
        headers['Authorization'] = `Bearer ${cookieOrApiKey}`;
      } else {
        headers['Cookie'] = cookieOrApiKey;
      }
    }

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers
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

module.exports = { loginUser, postJSON, postFormData, FormData };
