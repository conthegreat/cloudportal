import { createEvent } from '../lib/event.js';
import { parseRssItems } from '../lib/rss.js';
import { publicError, safeHttpUrl, stableId } from '../lib/text.js';
import { parseTime } from '../lib/time.js';
import { azureIsExplicitlyGlobal, extractAzureRegions } from './azure-regions.js';

const PUBLIC_FEED = 'https://azure.status.microsoft/en-gb/status/feed/';
const PUBLIC_PAGE = 'https://azure.status.microsoft/en-gb/status';
const SERVICE_HEALTH_API = '2025-05-01';
const OPERATIONAL_TYPES = new Set(['ServiceIssue', 'PlannedMaintenance', 'HealthAdvisory']);

function scopeFromText(text) {
  const regions = extractAzureRegions(text);
  const explicit = azureIsExplicitlyGlobal(text);
  const bareGlobal = regions.length === 0 && /\bglobal\b/i.test(text);
  return { regions, isGlobal: explicit || bareGlobal };
}

function severityFromText(text, eventType) {
  if (eventType === 'maintenance') return 'maintenance';
  if (/\b(outage|unavailable|disruption)\b/i.test(text)) return 'major';
  if (/\bpartial\b/i.test(text)) return 'partial';
  if (/\b(degrad|latency|error)\b/i.test(text)) return 'degraded';
  return 'minor';
}

export function classifyAzureRssItem(item) {
  if (!item || (!item.title && !item.description)) return null;
  const text = `${item.title || ''} ${item.description || ''}`;
  const scope = scopeFromText(text);
  const updatedAt = parseTime(item.pubDate);
  const resolved = /\b(resolved|mitigated|operating normally)\b/i.test(item.title || '');
  return createEvent({
    id: stableId('azure', item.guid || `${item.title}|${item.pubDate}`),
    provider: 'Azure',
    sourceProvider: 'azure',
    eventType: /\bmaintenance\b/i.test(text) ? 'maintenance' : 'incident',
    title: item.title,
    status: resolved ? 'resolved' : 'investigating',
    severity: severityFromText(text, /\bmaintenance\b/i.test(text) ? 'maintenance' : 'incident'),
    regions: scope.regions,
    isGlobal: scope.isGlobal,
    startedAt: updatedAt,
    updatedAt,
    endedAt: resolved ? updatedAt : null,
    summary: item.description || item.title,
    sourceUrl: safeHttpUrl(item.link) || PUBLIC_PAGE
  });
}

function impactParts(impact) {
  const regions = [];
  const services = [];
  for (const block of impact || []) {
    if (block?.impactedService) services.push(block.impactedService);
    for (const region of block?.impactedRegions || []) {
      if (region?.impactedRegion) regions.push(region.impactedRegion);
    }
  }
  return { regions, services };
}

export function classifyAzureServiceHealthEvent(resource) {
  const properties = resource?.properties || {};
  const eventTypeName = properties.eventType || '';
  if (!OPERATIONAL_TYPES.has(eventTypeName)) return null;
  const impact = impactParts(properties.impact);
  const text = `${properties.title || ''} ${properties.summary || ''} ${impact.regions.join(' ')}`;
  const scope = scopeFromText(text);
  const maintenance = eventTypeName === 'PlannedMaintenance';
  const start = parseTime(properties.impactStartTime);
  const end = parseTime(properties.impactMitigationTime);
  const updatedAt = parseTime(properties.lastUpdateTime) || start;
  const rawStatus = String(properties.status || '');
  let status = 'investigating';
  if (/resolved|closed|mitigated/i.test(rawStatus)) status = maintenance ? 'completed' : 'resolved';
  else if (maintenance && start && new Date(start) > new Date()) status = 'scheduled';
  else if (maintenance) status = 'in_progress';
  else if (/active/i.test(rawStatus)) status = 'identified';
  const level = String(properties.level || '');
  let severity = maintenance ? 'maintenance' : 'degraded';
  if (!maintenance && /critical|error/i.test(level)) severity = 'major';
  if (!maintenance && /warning/i.test(level)) severity = 'degraded';
  return createEvent({
    id: `azure-${resource.name || stableId('azsh', properties.title)}`,
    provider: 'Azure',
    sourceProvider: 'azure',
    eventType: maintenance ? 'maintenance' : 'incident',
    title: properties.title || 'Azure Service Health event',
    status,
    severity,
    affectedServices: impact.services,
    affectedComponents: impact.services,
    regions: scope.regions,
    isGlobal: scope.isGlobal,
    startedAt: start || updatedAt,
    updatedAt,
    endedAt: status === 'resolved' || status === 'completed' ? (end || updatedAt) : null,
    scheduledFor: maintenance ? start : null,
    scheduledUntil: maintenance ? end : null,
    summary: properties.summary || properties.header || properties.title,
    sourceUrl: 'https://portal.azure.com/'
  });
}

function credentials(env) {
  const tenantId = env.AZURE_TENANT_ID || '';
  const clientId = env.AZURE_CLIENT_ID || '';
  const clientSecret = env.AZURE_CLIENT_SECRET || '';
  const subscriptionId = env.AZURE_SUBSCRIPTION_ID || '';
  if (!tenantId && !clientId && !clientSecret && !subscriptionId) return null;
  if (!tenantId || !clientId || !clientSecret || !subscriptionId) {
    throw new Error('Azure Service Health configuration is incomplete');
  }
  const guid = /^[0-9a-f-]{36}$/i;
  if (!guid.test(tenantId) || !guid.test(clientId) || !subscriptionId.split(',').every((item) => guid.test(item.trim()))) {
    throw new Error('Azure Service Health identifiers are not valid GUIDs');
  }
  return {
    tenantId,
    clientId,
    clientSecret,
    subscriptionIds: subscriptionId.split(',').map((item) => item.trim())
  };
}

async function accessToken(http, auth) {
  const body = new URLSearchParams({
    client_id: auth.clientId,
    client_secret: auth.clientSecret,
    scope: 'https://management.azure.com/.default',
    grant_type: 'client_credentials'
  });
  const response = await fetch(`https://login.microsoftonline.com/${auth.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Cloud-Status/1.0' },
    body,
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`Azure authentication failed with HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.access_token) throw new Error('Azure authentication returned no token');
  return payload.access_token;
}

async function listServiceHealth(http, token, subscriptionId) {
  const start = new Date(Date.now() - 30 * 864e5);
  const queryStart = `${start.getUTCMonth() + 1}/${start.getUTCDate()}/${start.getUTCFullYear()}`;
  let url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.ResourceHealth/events?api-version=${SERVICE_HEALTH_API}&queryStartTime=${encodeURIComponent(queryStart)}`;
  const events = [];
  for (let page = 0; page < 5 && url; page += 1) {
    const parsed = new URL(url);
    if (parsed.hostname !== 'management.azure.com') throw new Error('Azure Service Health returned an unexpected page link');
    const payload = await http.json(url, {
      label: 'Azure Service Health',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!Array.isArray(payload?.value)) throw new Error('Azure Service Health returned an unexpected payload');
    events.push(...payload.value);
    url = typeof payload.nextLink === 'string' ? payload.nextLink : '';
  }
  return events;
}

export async function retrieve(ctx) {
  const env = ctx.env || (typeof process === 'undefined' ? {} : process.env);
  let auth = null;
  try {
    auth = credentials(env);
  } catch (error) {
    ctx.log(`[azure] ${publicError(error)}. Falling back to Public Azure Status.`);
  }
  if (auth) {
    try {
      const token = await accessToken(ctx.http, auth);
      const collected = [];
      for (const subscriptionId of auth.subscriptionIds) {
        collected.push(...await listServiceHealth(ctx.http, token, subscriptionId));
      }
      const events = collected.map(classifyAzureServiceHealthEvent).filter(Boolean);
      return { events, sourceLabel: 'Azure Service Health', warnings: [] };
    } catch (error) {
      ctx.log(`[azure] Azure Service Health failed (${publicError(error)}). Falling back to Public Azure Status.`);
    }
  } else {
    ctx.log('[azure] Azure Service Health is not configured. Using Public Azure Status.');
  }

  const feedUrl = ctx.providerConfig.feedUrl || PUBLIC_FEED;
  const xml = await ctx.http.text(feedUrl, { label: 'Public Azure Status' });
  const items = parseRssItems(xml);
  return {
    events: items.map(classifyAzureRssItem).filter(Boolean),
    sourceLabel: 'Public Azure Status',
    warnings: []
  };
}
