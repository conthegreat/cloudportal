import { createEvent } from '../lib/event.js';
import { unique } from '../lib/text.js';
import { parseTime } from '../lib/time.js';

const PAGE = 'https://synturastatus.io/';
const FEED = 'https://api.synturastatus.io/data';

function eventTypeFor(typeName, statusName) {
  const type = typeName.toLowerCase();
  if (/outage|incident|degrad/.test(type)) return 'incident';
  if (/planned|maintenance|works|at risk/.test(type)) return 'maintenance';
  if (/planned|scheduled/.test(statusName.toLowerCase())) return 'maintenance';
  return 'incident';
}

function statusFor(statusName, kind, start, now) {
  const name = statusName.toLowerCase();
  if (/closed|resolved|complete/.test(name)) return kind === 'maintenance' ? 'completed' : 'resolved';
  if (/progress|ongoing|open|investigating/.test(name)) return kind === 'maintenance' ? 'in_progress' : 'investigating';
  if (/identified/.test(name)) return 'identified';
  if (/monitoring/.test(name)) return 'monitoring';
  if (/planned|scheduled/.test(name)) return 'scheduled';
  if (kind === 'maintenance' && start && new Date(start) > now) return 'scheduled';
  return kind === 'maintenance' ? 'scheduled' : 'investigating';
}

function severityFor(typeName, kind) {
  if (kind === 'maintenance') return 'maintenance';
  if (/outage/.test(typeName.toLowerCase())) return 'major';
  if (/degrad|at risk/.test(typeName.toLowerCase())) return 'degraded';
  return 'minor';
}

export function classifySynturaItem(item, now = new Date()) {
  if (!item?.uuid || item.published === false) return null;
  const typeName = item.type?.name || '';
  const statusName = item.status?.name || '';
  const kind = eventTypeFor(typeName, statusName);
  const start = parseTime(item.startDate);
  const end = parseTime(item.endDate);
  const updatedAt = parseTime(item.times?.updated) || parseTime(item.times?.created) || start;
  const status = statusFor(statusName, kind, start, now);
  const closed = status === 'resolved' || status === 'completed';
  const lastUpdate = (item.updates || []).map((update) => parseTime(update.times?.updated || update.times?.created)).filter(Boolean).sort().at(-1);
  const services = unique((item.components || []).map((component) => component.title));
  const locations = unique((item.locations || []).flatMap((location) => [location.code, location.name]));
  const summary = (item.updates || []).at(-1)?.update_content || item.content || item.title;
  return createEvent({
    id: `syntura-${item.uuid}`,
    provider: 'Syntura, formerly hSo',
    sourceProvider: 'syntura',
    eventType: kind,
    title: item.title,
    status,
    severity: severityFor(typeName, kind),
    affectedServices: services,
    affectedComponents: services,
    locations,
    isGlobal: false,
    startedAt: start || updatedAt,
    updatedAt: lastUpdate || updatedAt,
    endedAt: closed ? (lastUpdate || updatedAt || end) : null,
    scheduledFor: kind === 'maintenance' ? start : null,
    scheduledUntil: kind === 'maintenance' ? end : null,
    summary,
    sourceUrl: PAGE
  });
}

export async function retrieve(ctx) {
  const feedUrl = ctx.providerConfig.feedUrl || FEED;
  const payload = await ctx.http.json(feedUrl, { label: 'Syntura status' });
  const items = Array.isArray(payload?.items) ? payload.items : null;
  if (!items) throw new Error('Syntura status returned an unexpected payload');
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  return {
    events: items.map((item) => classifySynturaItem(item, now)).filter(Boolean),
    sourceLabel: 'Syntura status',
    warnings: []
  };
}
