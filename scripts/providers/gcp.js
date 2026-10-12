import { createEvent } from '../lib/event.js';
import { publicError, unique } from '../lib/text.js';
import { parseTime } from '../lib/time.js';

const PUBLIC_FEED = 'https://status.cloud.google.com/incidents.json';
const PUBLIC_PAGE = 'https://status.cloud.google.com/';
const REGION_PATTERN = /\b((?:africa|asia|australia|europe|me|northamerica|southamerica|us)-(?:central|east|west|north|south|northeast|northwest|southeast|southwest)\d|[a-z]+-[a-z0-9]+\d)\b/g;

function locationIds(incident) {
  const ids = [];
  for (const list of [incident.currently_affected_locations, incident.previously_affected_locations]) {
    for (const location of list || []) if (location?.id) ids.push(String(location.id));
  }
  for (const update of incident.updates || []) {
    for (const location of update.affected_locations || []) if (location?.id) ids.push(String(location.id));
  }
  return unique(ids);
}

function textRegionIds(text) {
  return unique([...(String(text || '').matchAll(REGION_PATTERN))].map((match) => match[1].toLowerCase()));
}

function latestUpdate(incident) {
  let latest = null;
  for (const update of incident.updates || []) {
    if (!latest || String(update.modified || update.when || '') > String(latest.modified || latest.when || '')) latest = update;
  }
  return latest || incident.most_recent_update || null;
}

export function classifyGcpIncident(incident, now = new Date()) {
  if (!incident?.id) return null;
  let ids = locationIds(incident);
  const latest = latestUpdate(incident);
  const summary = latest?.text || incident.external_desc || '';
  if (ids.length === 0) ids = textRegionIds(`${incident.external_desc || ''} ${summary}`);
  const isGlobal = ids.some((id) => id.toLowerCase() === 'global');
  const regions = ids.filter((id) => id.toLowerCase() !== 'global');
  const products = unique((incident.affected_products || []).map((product) => product.current_title || product.title || product.id));
  const endedAt = parseTime(incident.end);
  const resolved = Boolean(endedAt && new Date(endedAt) <= now);
  const impact = String(incident.status_impact || '');
  let severity = 'degraded';
  if (impact === 'SERVICE_OUTAGE' || incident.severity === 'high') severity = 'major';
  else if (impact === 'SERVICE_INFORMATION' || incident.severity === 'low') severity = 'minor';
  else if (impact === 'SERVICE_DISRUPTION') severity = 'degraded';
  const updateStatus = String(latest?.status || '');
  let status = resolved ? 'resolved' : 'investigating';
  if (!resolved && /OUTAGE/.test(updateStatus)) status = 'identified';
  if (!resolved && /DISRUPTION/.test(updateStatus)) status = 'identified';
  const link = typeof incident.uri === 'string' && incident.uri.startsWith('http')
    ? incident.uri
    : `${PUBLIC_PAGE}incidents/${incident.id}`;
  return createEvent({
    id: `gcp-${incident.id}`,
    provider: 'Google Cloud Platform',
    sourceProvider: 'gcp',
    eventType: 'incident',
    title: incident.external_desc || incident.service_name || 'Google Cloud incident',
    status,
    severity,
    affectedServices: products,
    affectedComponents: products,
    regions,
    isGlobal,
    startedAt: parseTime(incident.begin) || parseTime(incident.created),
    updatedAt: parseTime(incident.modified) || parseTime(latest?.modified) || parseTime(incident.begin),
    endedAt: resolved ? endedAt : null,
    summary,
    sourceUrl: link
  });
}

export function classifyGcpPersonalizedEvent(event) {
  if (!event?.name && !event?.title) return null;
  if (['NOT_IMPACTED', 'FALSE_POSITIVE', 'MERGED', 'AUTO_CLOSED'].includes(event.relevance) || event.detailedState === 'FALSE_POSITIVE' || event.detailedState === 'MERGED') {
    return null;
  }
  const regions = [];
  const services = [];
  let isGlobal = false;
  for (const impact of event.eventImpacts || []) {
    if (impact?.product?.productName) services.push(impact.product.productName);
    const location = impact?.location?.locationName || '';
    if (!location) continue;
    if (/^global$/i.test(location)) isGlobal = true;
    else regions.push(location);
  }
  const detailed = event.detailedState || '';
  const resolved = detailed === 'RESOLVED' || event.state === 'CLOSED';
  const maintenance = /maintenance/i.test(`${event.category || ''} ${event.title || ''}`);
  let status = 'investigating';
  if (resolved) status = maintenance ? 'completed' : 'resolved';
  else if (detailed === 'CONFIRMED') status = 'identified';
  else if (detailed === 'EMERGING') status = 'investigating';
  const id = String(event.name || event.title).split('/').pop();
  return createEvent({
    id: `gcp-psh-${id}`,
    provider: 'Google Cloud Platform',
    sourceProvider: 'gcp',
    eventType: maintenance ? 'maintenance' : 'incident',
    title: event.title || 'Google Cloud service health event',
    status,
    severity: maintenance ? 'maintenance' : (detailed === 'CONFIRMED' ? 'major' : 'degraded'),
    affectedServices: services,
    affectedComponents: services,
    regions,
    isGlobal,
    startedAt: parseTime(event.startTime),
    updatedAt: parseTime(event.updateTime) || parseTime(event.startTime),
    endedAt: resolved ? (parseTime(event.endTime) || parseTime(event.updateTime)) : null,
    scheduledFor: maintenance ? parseTime(event.startTime) : null,
    scheduledUntil: maintenance ? parseTime(event.endTime) : null,
    summary: event.description || (event.updates || []).at(-1)?.text || event.title,
    sourceUrl: PUBLIC_PAGE
  });
}

async function retrievePersonalized(ctx) {
  const env = ctx.env || (typeof process === 'undefined' ? {} : process.env);
  const token = env.GCP_ACCESS_TOKEN || '';
  const projectId = env.GCP_PROJECT_ID || '';
  if (!token && !projectId) return null;
  if (!token || !projectId) throw new Error('Google Cloud personalised Service Health configuration is incomplete');
  if (!/^[a-z0-9-]{4,63}$/.test(projectId)) throw new Error('GCP project id is not a valid identifier');
  const url = `https://servicehealth.googleapis.com/v1/projects/${projectId}/locations/global/events?pageSize=100&view=EVENT_VIEW_FULL`;
  const payload = await ctx.http.json(url, {
    label: 'Google Cloud Service Health',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!Array.isArray(payload?.events)) throw new Error('Google Cloud Service Health returned an unexpected payload');
  return payload.events.map(classifyGcpPersonalizedEvent).filter(Boolean);
}

export async function retrieve(ctx) {
  const warnings = [];
  try {
    const personalised = await retrievePersonalized(ctx);
    if (personalised) {
      return { events: personalised, sourceLabel: 'Google Cloud Service Health', warnings };
    }
    ctx.log('[gcp] Personalised Service Health is not configured. Using the public incidents file.');
  } catch (error) {
    warnings.push(`Personalised Service Health failed (${publicError(error)})`);
    ctx.log(`[gcp] ${warnings[0]}. Using the public incidents file.`);
  }
  const feedUrl = ctx.providerConfig.feedUrl || PUBLIC_FEED;
  const payload = await ctx.http.json(feedUrl, { label: 'Google Cloud status' });
  if (!Array.isArray(payload)) throw new Error('Google Cloud status returned an unexpected payload');
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  return {
    events: payload.map((incident) => classifyGcpIncident(incident, now)).filter(Boolean),
    sourceLabel: 'Public Google Cloud Status',
    warnings
  };
}
