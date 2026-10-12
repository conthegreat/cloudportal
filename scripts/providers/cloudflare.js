import { createEvent } from '../lib/event.js';
import { norm, unique } from '../lib/text.js';
import { parseTime } from '../lib/time.js';
import {
  buildComponentIndex,
  componentNames,
  fetchStatuspage,
  latestUpdateBody,
  mapStatuspageStatus,
  severityFromImpact,
  statuspageSource
} from './statuspage.js';

const BASE = 'https://www.cloudflarestatus.com';
const PLATFORM_GROUP = 'Cloudflare Sites and Services';
const GEOGRAPHY = [
  ['china', /\bchina\b/i],
  ['singapore', /\bsingapore\b/i],
  ['japan', /\b(japan|tokyo)\b/i],
  ['hong-kong', /\bhong kong\b/i],
  ['australia', /\b(australia|sydney)\b/i],
  ['india', /\bindia\b/i],
  ['asia', /\b(asia|apac)\b/i],
  ['north-america', /\bnorth america\b/i],
  ['south-america', /\b(south america|latin america)\b/i],
  ['oceania', /\boceania\b/i],
  ['africa', /\bafrica\b/i],
  ['middle-east', /\bmiddle east\b/i],
  ['europe', /\beurope\b/i]
];

function geography(name) {
  return GEOGRAPHY.filter(([, pattern]) => pattern.test(name)).map(([code]) => code);
}

export function classifyCloudflareEvent(event, index, kind, providerConfig = {}) {
  if (!event?.id) return null;
  const { names, groups } = componentNames(event, index);
  const configuredGlobal = new Set((providerConfig.globalServices || []).map((name) => norm(name)));
  const locations = [];
  const regions = [];
  const globals = [];
  const considered = unique([...names, ...groups]);
  for (const name of considered) {
    const colo = String(name).match(/\(([A-Z]{3})\)\s*$/);
    if (colo) {
      locations.push(colo[1]);
      continue;
    }
    const places = geography(name);
    if (places.length) {
      regions.push(...places);
      continue;
    }
    if (name === PLATFORM_GROUP) continue;
    const listed = configuredGlobal.has(norm(name));
    if (groups.includes(PLATFORM_GROUP) || listed) globals.push(name);
  }
  const isGlobal = locations.length === 0 && regions.length === 0 && globals.length > 0 && providerConfig.includeGlobal !== false;
  const status = mapStatuspageStatus(event.status, kind);
  const resolved = status === 'resolved' || status === 'completed';
  const summary = latestUpdateBody(event);
  return createEvent({
    id: `cloudflare-${event.id}`,
    provider: 'Cloudflare',
    sourceProvider: 'cloudflare',
    eventType: kind,
    title: event.name,
    status,
    severity: severityFromImpact(event.impact, kind),
    affectedServices: names,
    affectedComponents: names,
    regions,
    locations,
    isGlobal,
    startedAt: parseTime(event.started_at) || parseTime(event.created_at),
    updatedAt: parseTime(event.updated_at) || parseTime(event.started_at),
    endedAt: resolved ? parseTime(event.resolved_at) || parseTime(event.updated_at) : null,
    scheduledFor: kind === 'maintenance' ? parseTime(event.scheduled_for) : null,
    scheduledUntil: kind === 'maintenance' ? parseTime(event.scheduled_until) : null,
    summary: summary || event.name,
    sourceUrl: statuspageSource(event, `${BASE}/incidents/${event.id}`)
  });
}

export async function retrieve(ctx) {
  const feed = new URL(ctx.providerConfig.feedUrl || `${BASE}/api/v2/summary.json`);
  const bundle = await fetchStatuspage(feed.origin, ctx, 'Cloudflare status');
  const index = buildComponentIndex(bundle.components);
  const events = [
    ...bundle.incidents.map((incident) => classifyCloudflareEvent(incident, index, 'incident', ctx.providerConfig)),
    ...bundle.maintenances.map((maintenance) => classifyCloudflareEvent(maintenance, index, 'maintenance', ctx.providerConfig))
  ].filter(Boolean);
  for (const warning of bundle.warnings) ctx.log(`[cloudflare] partial feed: ${warning}`);
  return { events, sourceLabel: 'Cloudflare Status API', warnings: bundle.warnings };
}
