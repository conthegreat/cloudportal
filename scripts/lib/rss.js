function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function readTag(block, name) {
  const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

export function parseRssItems(xml) {
  if (typeof xml !== 'string' || !xml.includes('<')) {
    throw new Error('Feed was not XML');
  }
  const items = [];
  const pattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  for (const match of xml.matchAll(pattern)) {
    if (items.length >= 500) break;
    const block = match[1];
    items.push({
      title: readTag(block, 'title'),
      link: readTag(block, 'link'),
      description: readTag(block, 'description'),
      pubDate: readTag(block, 'pubDate'),
      guid: readTag(block, 'guid')
    });
  }
  return items;
}
