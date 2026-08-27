export class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/**
 * @param {string} input       YouTube URL or bare video ID.
 * @param {{ lang?: string, translateTo?: string, signal?: AbortSignal }} [options]
 */
export async function fetchTranscript(input, options = {}) {
  const params = new URLSearchParams({ v: input });
  if (options.lang) params.set('lang', options.lang);
  if (options.translateTo) params.set('translateTo', options.translateTo);

  let response;
  try {
    response = await fetch(`/api/transcript?${params}`, { signal: options.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Network error — check your connection and try again.', 'NETWORK');
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new ApiError('The server returned something unreadable.', 'BAD_RESPONSE');
  }

  if (!response.ok) {
    throw new ApiError(body.error || `Request failed (${response.status}).`, body.code || 'UNKNOWN');
  }
  return body;
}
