import { createEvent } from '../lib/event.js';
import { parseRssItems } from '../lib/rss.js';
import { safeHttpUrl, stableId, unique } from '../lib/text.js';
import { parseTime } from '../lib/time.js';

const PUBLIC_PAGE = 'https://health.aws.amazon.com/health/status';
const PUBLIC_FEED = 'https://status.aws.amazon.com/rss/all.rss';
const REGION_PATTERN = /\b((?:af|ap|ca|eu|il|me|mx|sa|us)-(?:central|north|south|east|west|northeast|northwest|southeast|southwest)-\d|cn-(?:north|northwest)-\d|us-gov-(?:east|west)-\d)\b/gi;

export function extractAwsRegions(text) {
  return unique([...(String(text || '').matchAll(REGION_PATTERN))].map((match) => match[1].toLowerCase()));
}

function serviceSlug(guid) {
  const match = String(guid || '').match(/#([a-z0-9-]+)_\d+/i);
  if (!match) return '';
  let slug = match[1].toLowerCase();
  for (const region of extractAwsRegions(slug)) {
    if (slug.endsWith(region)) slug = slug.slice(0, -region.length).replace(/-$/, '');
  }
  return slug;
}

function slugHas(slug, service) {
  const needle = String(service || '').toLowerCase();
  return Boolean(needle) && (slug === needle || slug.endsWith(`-${needle}`) || slug.includes(needle));
}

export function classifyAwsRssItem(item, providerConfig = {}) {
  if (!item || (!item.title && !item.description)) return null;
  const text = `${item.title || ''}\n${item.description || ''}\n${item.guid || ''}`;
  const regions = extractAwsRegions(text);
  const slug = serviceSlug(item.guid);
  const explicitGlobal = /\b(all regions|across all regions|globally)\b/i.test(text);
  const serviceGlobal = regions.length === 0 && (providerConfig.globalServices || []).some((service) => slugHas(slug, service));
  const maintenance = /\bmaintenance\b/i.test(item.title || '') || /\bscheduled maintenance\b/i.test(item.description || '');
  const resolved = /\b(operating normally|resolved)\b/i.test(item.title || '');
  let severity = 'minor';
  let status = resolved ? 'resolved' : 'investigating';
  if (maintenance) {
    severity = 'maintenance';
    status = resolved ? 'completed' : 'scheduled';
  } else if (/\b(disruption|outage|unavailable)\b/i.test(item.title || '')) {
    severity = 'major';
  } else if (/\b(degrad|error rate|latency|increased error)\b/i.test(text)) {
    severity = 'degraded';
  }
  const updatedAt = parseTime(item.pubDate);
  return createEvent({
    id: stableId('aws', item.guid || `${item.title}|${item.pubDate}`),
    provider: 'Amazon Web Services',
    sourceProvider: 'aws',
    eventType: maintenance ? 'maintenance' : 'incident',
    title: item.title,
    status,
    severity,
    affectedServices: slug ? [slug] : [],
    regions,
    isGlobal: explicitGlobal || serviceGlobal,
    startedAt: updatedAt,
    updatedAt,
    endedAt: resolved ? updatedAt : null,
    scheduledFor: maintenance ? updatedAt : null,
    summary: item.description || item.title,
    sourceUrl: safeHttpUrl(item.guid) || safeHttpUrl(item.link) || PUBLIC_PAGE
  });
}

export async function retrieve(ctx) {
  ctx.log('[aws] Using the public AWS Health RSS feed. Account-specific Health events are not configured.');
  const feedUrl = ctx.providerConfig.feedUrl || PUBLIC_FEED;
  const xml = await ctx.http.text(feedUrl, { label: 'Public AWS Health' });
  const items = parseRssItems(xml);
  return {
    events: items.map((item) => classifyAwsRssItem(item, ctx.providerConfig)).filter(Boolean),
    sourceLabel: 'Public AWS Health',
    warnings: []
  };
}
