import { parseTime } from '../lib/time.js';
import { publicError, safeHttpUrl, toPlainText, unique } from '../lib/text.js';

const PATHS = [
  ['/api/v2/summary.json', 'summary'],
  ['/api/v2/components.json', 'components'],
  ['/api/v2/incidents/unresolved.json', 'incidents'],
  ['/api/v2/incidents.json', 'incidents'],
  ['/api/v2/scheduled-maintenances/active.json', 'maintenances'],
  ['/api/v2/scheduled-maintenances/upcoming.json', 'maintenances']
];

export function buildComponentIndex(components) {
  const byId = new Map();
  for (const component of components || []) {
    if (component?.id) byId.set(component.id, component);
  }
  for (const [id, component] of byId) {
    const group = component.group_id ? byId.get(component.group_id) : null;
    byId.set(id, { ...component, groupName: group?.name || '' });
  }
  return byId;
}

export function latestUpdateBody(event) {
  let latest = null;
  for (const update of event?.incident_updates || []) {
    const when = parseTime(update.created_at) || '';
    const current = parseTime(latest?.created_at) || '';
    if (!latest || when > current) latest = update;
  }
  return toPlainText(latest?.body || '');
}

export function mapStatuspageStatus(status, kind) {
  const value = String(status || '').toLowerCase();
  if (value === 'completed' || value === 'resolved' || value === 'postmortem') {
    return kind === 'maintenance' ? 'completed' : 'resolved';
  }
  if (value === 'verifying') return kind === 'maintenance' ? 'in_progress' : 'monitoring';
  if (['investigating', 'identified', 'monitoring', 'scheduled', 'in_progress'].includes(value)) return value;
  return kind === 'maintenance' ? 'scheduled' : 'investigating';
}

export function severityFromImpact(impact, kind) {
  if (kind === 'maintenance') return 'maintenance';
  if (impact === 'critical') return 'major';
  if (impact === 'major') return 'partial';
  if (impact === 'minor') return 'degraded';
  return 'minor';
}

export function componentNames(event, index) {
  const names = [];
  const groups = [];
  for (const component of event?.components || []) {
    const meta = index.get(component.id);
    const name = meta?.name || component.name || '';
    if (name) names.push(name);
    if (meta?.groupName) groups.push(meta.groupName);
  }
  return { names: unique(names), groups: unique(groups) };
}

export function statuspageSource(event, fallback) {
  return safeHttpUrl(event.shortlink) || safeHttpUrl(fallback);
}

function takeList(payload, key) {
  const value = payload?.[key];
  return Array.isArray(value) ? value : [];
}

export async function fetchStatuspage(baseUrl, ctx, label) {
  const warnings = [];
  const components = [];
  const incidents = new Map();
  const maintenances = new Map();
  let successes = 0;
  for (const [path, bucket] of PATHS) {
    try {
      const payload = await ctx.http.json(`${baseUrl}${path}`, { label });
      successes += 1;
      if (bucket === 'summary' || bucket === 'components') components.push(...takeList(payload, 'components'));
      if (bucket === 'summary' || bucket === 'incidents') {
        for (const incident of takeList(payload, 'incidents')) {
          if (incident?.id && !incidents.has(incident.id)) incidents.set(incident.id, incident);
        }
      }
      if (bucket === 'summary' || bucket === 'maintenances') {
        for (const maintenance of takeList(payload, 'scheduled_maintenances')) {
          if (maintenance?.id && !maintenances.has(maintenance.id)) maintenances.set(maintenance.id, maintenance);
        }
      }
    } catch (error) {
      warnings.push(`${path} ${publicError(error)}`);
    }
  }
  if (successes === 0) throw new Error(`${label} could not be retrieved`);
  return {
    components,
    incidents: [...incidents.values()],
    maintenances: [...maintenances.values()],
    warnings
  };
}
