const SEVERITY_RANK = { major: 0, partial: 1, degraded: 2, minor: 3, maintenance: 4 };
const STATUS_LABELS = {
  major: 'Major outage',
  partial: 'Partial outage',
  degraded: 'Degraded performance',
  maintenance: 'Maintenance',
  operational: 'Operational',
  unknown: 'Unknown'
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.unknown;
}

export function isCurrentIncident(event) {
  return event.included
    && event.eventType === 'incident'
    && event.status !== 'resolved'
    && event.status !== 'completed';
}

export function isVisibleMaintenance(event) {
  return event.included && event.eventType === 'maintenance' && (
    event.status === 'scheduled' || event.status === 'in_progress' || event.status === 'completed'
  );
}

function severityToStatus(severity) {
  if (severity === 'major') return 'major';
  if (severity === 'partial') return 'partial';
  if (severity === 'degraded' || severity === 'minor') return 'degraded';
  if (severity === 'maintenance') return 'maintenance';
  return 'degraded';
}

export function worstStatus(statuses) {
  const rank = { major: 0, partial: 1, degraded: 2, maintenance: 3, unknown: 4, operational: 5 };
  let winner = 'operational';
  for (const status of statuses) {
    if ((rank[status] ?? 9) < (rank[winner] ?? 9)) winner = status;
  }
  return winner;
}

export function statusFromEvents(events) {
  const current = events.filter(isCurrentIncident);
  const maintenance = events.filter((event) => event.included && event.eventType === 'maintenance' && (
    event.status === 'scheduled' || event.status === 'in_progress'
  ));
  if (current.length === 0 && maintenance.length === 0) return 'operational';
  return worstStatus([
    ...current.map((event) => severityToStatus(event.severity)),
    ...maintenance.map(() => 'maintenance')
  ]);
}

export function providerStatus(events, meta) {
  if (!meta?.hasCache) return 'unknown';
  return statusFromEvents(events);
}

export function overallStatus(providerStatuses) {
  const active = providerStatuses.filter((status) => status !== 'operational' && status !== 'unknown');
  if (active.length) return worstStatus(active);
  if (providerStatuses.includes('unknown')) return 'unknown';
  return 'operational';
}

export function sortIncidents(events) {
  return events.slice().sort((left, right) => {
    const severity = (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9);
    if (severity) return severity;
    const type = (left.eventType === 'incident' ? 0 : 1) - (right.eventType === 'incident' ? 0 : 1);
    if (type) return type;
    return Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0);
  });
}

export function sortMaintenance(events) {
  const rank = { in_progress: 0, scheduled: 1, completed: 2, resolved: 3 };
  return events.slice().sort((left, right) => {
    const state = (rank[left.status] ?? 9) - (rank[right.status] ?? 9);
    if (state) return state;
    return Date.parse(left.scheduledFor || left.startedAt || 0) - Date.parse(right.scheduledFor || right.startedAt || 0);
  });
}

export function formatLondon(iso, timeZone = 'Europe/London') {
  if (!iso) return 'Unknown time';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short'
  }).format(date);
}

export function formatDuration(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 'Unknown duration';
  return formatSpan(end.getTime() - start.getTime());
}

export function formatRemaining(event, now = new Date()) {
  if (event.status === 'completed' || event.status === 'resolved') return 'Completed';
  if (event.status === 'in_progress' && event.scheduledUntil) {
    const end = new Date(event.scheduledUntil);
    if (end > now) return `Ends in ${formatSpan(end.getTime() - now.getTime())}`;
    return 'Expected end has passed';
  }
  if (event.scheduledFor) {
    const start = new Date(event.scheduledFor);
    if (start > now) return `Starts in ${formatSpan(start.getTime() - now.getTime())}`;
  }
  return 'Timing unavailable';
}

function formatSpan(milliseconds) {
  const minutes = Math.max(1, Math.round(milliseconds / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (!days && rest) parts.push(`${rest} minute${rest === 1 ? '' : 's'}`);
  return parts.join(' ') || '1 minute';
}

export function formatAge(iso, now = new Date()) {
  if (!iso) return 'unknown age';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'unknown age';
  const minutes = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
