import { createEvent } from '../lib/event.js';
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

const BASE = 'https://status.wifi.service.gov.uk';

export function classifyGovWifiEvent(event, index, kind) {
  if (!event?.id) return null;
  const { names } = componentNames(event, index);
  const summary = latestUpdateBody(event);
  const text = `${event.name || ''} ${summary}`;
  const isGlobal = /\b(global|worldwide|all sites)\b/i.test(text);
  const status = mapStatuspageStatus(event.status, kind);
  const resolved = status === 'resolved' || status === 'completed';
  return createEvent({
    id: `govwifi-${event.id}`,
    provider: 'GovWifi',
    sourceProvider: 'govwifi',
    eventType: kind,
    title: event.name,
    status,
    severity: severityFromImpact(event.impact, kind),
    affectedServices: names,
    affectedComponents: names,
    regions: ['uk'],
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
  const bundle = await fetchStatuspage(feed.origin, ctx, 'GovWifi status');
  const index = buildComponentIndex(bundle.components);
  const events = [
    ...bundle.incidents.map((incident) => classifyGovWifiEvent(incident, index, 'incident')),
    ...bundle.maintenances.map((maintenance) => classifyGovWifiEvent(maintenance, index, 'maintenance'))
  ].filter(Boolean);
  for (const warning of bundle.warnings) ctx.log(`[govwifi] partial feed: ${warning}`);
  return { events, sourceLabel: 'GovWifi status', warnings: bundle.warnings };
}
