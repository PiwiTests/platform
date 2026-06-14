/**
 * Client-side file serving for demo mode.
 *
 * Serves demo screenshot images by fetching the built static assets from the
 * public/ directory and returning them as binary data through the service worker.
 */

/**
 * Serve a demo file. For screenshot paths under demo/screenshots/, fetches
 * the actual PNG file from the build output and returns it as binary data.
 */
export async function apiGetDemoFile(apiPath: string): Promise<unknown> {
  const filePath = apiPath.replace(/^\/api\/files\//, '');

  if (!filePath.startsWith('demo/screenshots/')) {
    return { available: false, message: 'File not available in demo mode' };
  }

  try {
    const response = await fetch(`/${filePath}`);
    if (!response.ok) {
      return { available: false, message: 'Screenshot not found' };
    }

    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Convert to base64
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }

    return {
      _binary: true,
      data: btoa(binary),
      contentType: blob.type || 'image/png',
    };
  } catch {
    return { available: false, message: 'Failed to load screenshot' };
  }
}
