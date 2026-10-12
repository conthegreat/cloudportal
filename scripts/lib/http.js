export function createHttp() {
  return {
    async text(url, { timeoutMs = 20000, headers = {}, label = 'request' } = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': 'Cloud-Status/1.0',
            Accept: 'application/json, application/xml, text/xml, application/atom+xml, */*',
            ...headers
          }
        });
        if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
        const text = await response.text();
        if (text.length > 8_000_000) throw new Error(`${label} response was too large`);
        return text;
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error(`${label} timed out`);
        const message = error?.message || 'request failed';
        if (message.startsWith(label)) throw error;
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
