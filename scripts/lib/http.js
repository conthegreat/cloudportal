export function createHttp() {
  return {
    async text(url, { timeoutMs = 20000, headers = {}, label = 'request' } = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const requestHeaders = {
          Accept: 'application/json, application/xml, text/xml, application/atom+xml, */*',
          ...headers
        };
        if (typeof window === 'undefined') requestHeaders['User-Agent'] = 'Cloud-Status/1.0';
        const request = {
          signal: controller.signal,
          redirect: 'follow',
          headers: requestHeaders
        };
        // Bypass the browser HTTP cache so Reload cannot reuse an old feed.
        if (typeof window !== 'undefined') request.cache = 'no-store';
        const response = await fetch(url, request);
        if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
        const text = await response.text();
        if (text.length > 8_000_000) throw new Error(`${label} response was too large`);
        return text;
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error(`${label} timed out`);
        const message = error?.message || 'request failed';
        if (message.startsWith(label)) throw error;
        if (typeof window !== 'undefined' && (error?.name === 'TypeError' || /Failed to fetch|NetworkError/.test(message))) {
          throw new Error(`${label} cannot be read from this browser`);
        }
        throw new Error(`${label} failed`);
      } finally {
        clearTimeout(timer);
      }
    },
    async json(url, options = {}) {
      const text = await this.text(url, options);
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`${options.label || 'request'} returned malformed JSON`);
      }
    }
  };
}
