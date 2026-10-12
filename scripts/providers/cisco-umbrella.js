import { createEvent } from '../lib/event.js';
import { unique } from '../lib/text.js';
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

const BASE = 'https://status.umbrella.cisco.com';

export function ciscoSignals(text) {
  const source = String(text || '');
  const regions = [];
  let isGlobal = false;
  if (/\bumbrella global\b/i.test(source) || /\bglobal\b/i.test(source)) isGlobal = true;
  if (/\beurope\b/i.test(source) || /\bemea\b/i.test(source)) regions.push('europe');
  if (/\bEU\b/.test(source)) regions.push('eu');
  if (/\bapac\b/i.test(source)) regions.push('apac');
  if (/\baustralia\b/i.test(source)) regions.push('australia');
  if (/\bjapan\b/i.test(source)) regions.push('japan');
  if (/\bsingapore\b/i.test(source)) regions.push('singapore');
  if (/\bindia\b/i.test(source)) regions.push('india');
  if (/\bchina\b/i.test(source)) regions.push('china');
  if (/\bnorth america\b/i.test(source)) regions.push('north-america');
  if (/\bsouth america\b/i.test(source)) regions.push('south-america');
  if (/\bafrica\b/i.test(source)) regions.push('africa');
  if (/\basia\b/i.test(source)) regions.push('asia');
  return { regions: unique(regions), isGlobal };
}

function groupSignals(name) {
  return ciscoSignals(name);
}

export function classifyCiscoEvent(event, index, kind) {
  if (!event?.id) return null;
  const { names, groups } = componentNames(event, index);
  const summary = latestUpdateBody(event);
  const text = `${event.name || ''} ${summary}`;
  const fromText = ciscoSignals(text);
  const fromGroups = groups.map(groupSignals);
  const fromNames = names.map(groupSignals);
  const regions = unique([
    ...fromText.regions,
    ...fromGroups.flatMap((signal) => signal.regions),
    ...fromNames.flatMap((signal) => signal.regions)
  ]);
  const isGlobal = fromText.isGlobal || fromGroups.some((signal) => signal.isGlobal) || fromNames.some((signal) => signal.isGlobal);
  const scopeNames = [...groups, ...names];
  const umbrella = scopeNames.some((name) => /umbrella/i.test(name)) || /\bumbrella\b/i.test(text);
  const otherProduct = scopeNames.some((name) => /secure connect|cloudlock/i.test(name));
  const productOutOfScope = !umbrella && otherProduct;
  const status = mapStatuspageStatus(event.status, kind);
  const resolved = status === 'resolved' || status === 'completed';
  return createEvent({
    id: `cisco-${event.id}`,
    provider: 'Cisco Umbrella',
    sourceProvider: 'ciscoUmbrella',
    eventType: kind,
    title: event.name,
    status,
    severity: severityFromImpact(event.impact, kind),
    affectedServices: names,
    affectedComponents: names,
    regions,
    isGlobal,
    productOutOfScope,
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
  const bundle = await fetchStatuspage(feed.origin, ctx, 'Cisco Umbrella status');
  const index = buildComponentIndex(bundle.components);
  const events = [
    ...bundle.incidents.map((incident) => classifyCiscoEvent(incident, index, 'incident')),
    ...bundle.maintenances.map((maintenance) => classifyCiscoEvent(maintenance, index, 'maintenance'))
  ].filter(Boolean);
  for (const warning of bundle.warnings) ctx.log(`[ciscoUmbrella] partial feed: ${warning}`);
  return { events, sourceLabel: 'Cisco Umbrella status', warnings: bundle.warnings };
}
