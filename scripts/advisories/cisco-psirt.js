import { parseRssItems } from '../lib/rss.js';
import { safeHttpUrl, unique } from '../lib/text.js';
import { parseTime } from '../lib/time.js';

export const CISCO_ADVISORY_FEED = 'https://sec.cloudapps.cisco.com/security/center/psirtrss20/CiscoSecurityAdvisory.xml';
export const CISCO_ADVISORY_PAGE = 'https://sec.cloudapps.cisco.com/security/center/publicationListing.x';

const RATING = /Security Impact Rating:\s*(Critical|High|Medium|Low|Informational)/i;
const CVE_ID = /CVE-\d{4}-\d{4,7}/g;

function plainDescription(value) {
  let text = String(value || '');
  if (text.includes('&lt;') || text.includes('&amp;') || text.includes('&#')) {
    text = text
      .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;|&#034;/g, '"')
      .replace(/&#39;|&apos;/g, "'");
  }
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseCiscoTimestamp(value) {
  const match = String(value || '').trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (match) return `${match[1]}T${match[2]}Z`;
  return parseTime(value);
}

export function classifyCiscoAdvisory(item) {
  if (!item?.title) return null;
  if (/advance notification/i.test(item.title)) return null;
  const plain = plainDescription(`${item.title} ${item.description || ''}`);
  const cves = unique(plain.match(CVE_ID) || []);
  if (cves.length === 0) return null;
  const rating = plain.match(RATING);
  const severity = rating ? rating[1].toLowerCase() : 'unrated';
  const url = safeHttpUrl(item.guid) || safeHttpUrl(String(item.link || '').split('?')[0]);
  const summary = plainDescription(item.description).slice(0, 180);
  return {
    id: url || `${item.title}|${item.pubDate || ''}`,
    title: item.title.trim(),
    url,
    cves,
    severity,
    publishedAt: parseCiscoTimestamp(item.pubDate),
    summary
  };
}

export function selectCiscoAdvisories(items, limit) {
  const selected = items
    .map(classifyCiscoAdvisory)
    .filter(Boolean)
    .sort((left, right) => String(right.publishedAt || '').localeCompare(String(left.publishedAt || '')));
  if (Number.isFinite(limit) && limit > 0) return selected.slice(0, limit);
  return selected;
}

export function retainCiscoAdvisories(incoming, previous, { now = new Date(), retentionDays = 7 } = {}) {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 7;
  const cutoff = now.getTime() - days * 864e5;
  const byId = new Map();
  for (const item of [...(previous || []), ...(incoming || [])]) {
    if (!item?.id || !item.publishedAt) continue;
    const when = Date.parse(item.publishedAt);
    if (Number.isNaN(when) || when < cutoff) continue;
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) => String(right.publishedAt).localeCompare(String(left.publishedAt)));
}

export async function retrieveCiscoAdvisories({ http, feedUrl = CISCO_ADVISORY_FEED, limit } = {}) {
  const xml = await http.text(feedUrl, { label: 'Cisco PSIRT', timeoutMs: 30000 });
  const items = parseRssItems(xml);
  return {
    advisories: selectCiscoAdvisories(items, limit),
    sourceLabel: 'Cisco PSIRT',
    rawCount: items.length
  };
}
