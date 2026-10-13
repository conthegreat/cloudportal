import { createEvent } from '../lib/event.js';
import { parseRssItems } from '../lib/rss.js';
import { publicError, toPlainText, unique } from '../lib/text.js';
import { parseTime } from '../lib/time.js';

const RSS = 'https://ocistatus.oraclecloud.com/api/v2/incident-summary.rss';
const HEALTH = 'https://ocistatus.oraclecloud.com/api/v2/components.json';
const PAGE = 'https://ocistatus.oraclecloud.com/';

const UK_REGIONS = [
  ['uk-london-1', /UK South\s*\(\s*London\s*\)|\buk-london-1\b/i],
  ['uk-cardiff-1', /UK West\s*\(\s*(?:Newport|Cardiff)\s*\)|\buk-cardiff-1\b/i]
];

const UK_HEALTH_IDS = {
  'uk-london-1': 'uk-london-1',
  'mc-uk-london-1': 'uk-london-1',
  'uk-cardiff-1': 'uk-cardiff-1',
  'mc-uk-cardiff-1': 'uk-cardiff-1'
};

function titleParts(title) {
  const parts = String(title || '').split('|').map((part) => part.trim()).filter(Boolean);
  return {
    service: parts[0] || 'Oracle Cloud',
    place: parts[1] || '',
    reference: parts[2] || ''
  };
}

function labeledTime(plain, label) {
  const match = String(plain || '').match(new RegExp(`${label}\\s*:\\s*([A-Za-z]+\\s+\\d{1,2},\\s+\\d{4}\\s+\\d{1,2}:\\d{2}\\s+UTC)`, 'i'));
  return match ? parseTime(match[1]) : null;
}

export function oracleScope(title, description) {
  const text = `${title || ''} ${description || ''}`;
  const regions = [];
  for (const [code, pattern] of UK_REGIONS) {
    if (pattern.test(text)) regions.push(code);
  }
  const place = titleParts(title).place;
  const namedGlobal = /^(global|all regions|worldwide)$/i.test(place);
  const isGlobal = namedGlobal || /\b(?:all regions|all commercial regions|worldwide|globally|global issue)\b/i.test(text);
  if (place && !namedGlobal && !/multiple regions/i.test(place) && !UK_REGIONS.some(([, pattern]) => pattern.test(place))) {
    regions.push(place);
  }
  return { regions: unique(regions), isGlobal };
}

export function classifyOracleRssItem(item) {
  if (!item?.title) return null;
  const plain = toPlainText(item.description || '');
  const parts = titleParts(item.title);
  const scope = oracleScope(item.title, plain);
  const state = (plain.match(/\b(Resolved|Completed|Identified|Investigating|Monitoring|Scheduled)\b/i)?.[1] || '').toLowerCase();
  const maintenance = /\b(planned maintenance|scheduled maintenance)\b/i.test(`${item.title} ${plain}`) && state !== 'resolved' && state !== 'completed';
  const resolved = state === 'resolved' || state === 'completed';
  const status = maintenance
    ? (state === 'scheduled' ? 'scheduled' : 'in_progress')
    : resolved
      ? 'resolved'
      : (state || 'investigating');
  const updatedAt = parseTime(item.pubDate);
  const id = item.guid || parts.reference || item.link || item.title;
  return createEvent({
    id: `oracle-${id}`,
    provider: 'Oracle Cloud',
    sourceProvider: 'oracle',
    eventType: maintenance ? 'maintenance' : 'incident',
    title: item.title,
    status,
    severity: maintenance ? 'maintenance' : resolved ? 'minor' : state === 'identified' ? 'partial' : 'degraded',
    affectedServices: [parts.service],
    affectedComponents: [parts.service],
    regions: scope.regions,
    isGlobal: scope.isGlobal,
    startedAt: labeledTime(plain, 'Start Time') || updatedAt,
    updatedAt,
    endedAt: resolved ? labeledTime(plain, 'End Time') || updatedAt : null,
    summary: plain,
    sourceUrl: item.link || PAGE
  });
}

function healthSeverity(serviceStatus) {
  const value = String(serviceStatus || '');
  if (/normal/i.test(value) || !value) return null;
  if (/maintenance|planned/i.test(value)) return { eventType: 'maintenance', status: 'in_progress', severity: 'maintenance' };
  if (/down|outage|unavailable|disruption/i.test(value)) return { eventType: 'incident', status: 'identified', severity: 'major' };
  if (/degrad/i.test(value)) return { eventType: 'incident', status: 'identified', severity: 'degraded' };
  if (/info/i.test(value)) return { eventType: 'incident', status: 'monitoring', severity: 'minor' };
  return { eventType: 'incident', status: 'investigating', severity: 'degraded' };
}

export function classifyOracleHealthReport(report) {
  const byId = new Map();
  for (const region of report?.regionHealthReports || []) {
    const code = UK_HEALTH_IDS[region?.regionCanonicalName];
    if (!code) continue;
    for (const service of region.serviceHealthReports || []) {
      const mapped = healthSeverity(service?.serviceStatus);
      if (!mapped) continue;
      const serviceName = service.serviceName || service.serviceCanonicalName || 'Oracle Cloud service';
      const id = `oracle-health-${code}-${service.serviceCanonicalName || serviceName}`;
      if (byId.has(id)) continue;
      byId.set(id, createEvent({
        id,
        provider: 'Oracle Cloud',
        sourceProvider: 'oracle',
        eventType: mapped.eventType,
        title: `${serviceName} in ${region.regionName || code}`,
        status: mapped.status,
        severity: mapped.severity,
        affectedServices: [serviceName],
        affectedComponents: [serviceName],
        regions: [code],
        isGlobal: false,
        summary: `Oracle reports ${service.serviceStatus} for ${serviceName} in ${region.regionName || code}.`,
        sourceUrl: PAGE
      }));
    }
  }
  return [...byId.values()];
}

export async function retrieve(ctx) {
  const feedUrl = ctx.providerConfig.feedUrl || RSS;
  const healthUrl = ctx.providerConfig.healthUrl || HEALTH;
  const warnings = [];
  const [rssResult, healthResult] = await Promise.allSettled([
    ctx.http.text(feedUrl, { label: 'Oracle Cloud', timeoutMs: 30000 }),
    ctx.http.json(healthUrl, { label: 'Oracle Cloud', timeoutMs: 30000 })
  ]);
  if (rssResult.status === 'rejected' && healthResult.status === 'rejected') {
    throw rssResult.reason;
  }
  let events = [];
  if (rssResult.status === 'fulfilled') {
    try {
      events.push(...parseRssItems(rssResult.value).map(classifyOracleRssItem).filter(Boolean));
    } catch (error) {
      if (healthResult.status === 'rejected') throw error;
      warnings.push(publicError(error));
    }
  } else {
    warnings.push(publicError(rssResult.reason));
  }
  if (healthResult.status === 'fulfilled') {
    events.push(...classifyOracleHealthReport(healthResult.value));
  } else {
    warnings.push(publicError(healthResult.reason));
  }
  for (const warning of warnings) ctx.log(`[oracle] partial feed: ${warning}`);
  return { events, sourceLabel: 'OCI Status', warnings };
}
