import { safeHttpUrl } from '../lib/text.js';

export const CHECKPOINT_ADVISORY_FEED = 'https://iapi-services-ucs.checkpoint.com/public/api/support-center-mms/api/securityAdvisories/getAllActive';
export const CHECKPOINT_ADVISORY_PAGE = 'https://support.checkpoint.com/security-advisories';

const CVE_ID = /^CVE-\d{4}-\d{4,7}$/;
const SEVERITY = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  information: 'informational',
  informational: 'informational'
};

function publishedAt(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function classifyCheckpointAdvisory(item) {
  if (!item || item.enable === false) return null;
  const cve = String(item.cveId || '').trim().toUpperCase();
  if (!CVE_ID.test(cve)) return null;
  const when = publishedAt(item.published);
  if (!when) return null;
  const severity = SEVERITY[String(item.cpSeverity || '').trim().toLowerCase()] || 'unrated';
  const summary = String(item.summary || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  const id = item.id == null || item.id === '' ? `checkpoint:${cve}` : `checkpoint:${item.id}`;
  return {
    id,
    source: 'checkpoint',
    title: cve,
    url: safeHttpUrl(item.url),
    cves: [cve],
    severity,
    publishedAt: when,
    summary
  };
}

export function selectCheckpointAdvisories(items) {
  return (Array.isArray(items) ? items : [])
    .map(classifyCheckpointAdvisory)
    .filter(Boolean)
    .sort((left, right) => String(right.publishedAt).localeCompare(String(left.publishedAt)));
}

export function retainCheckpointAdvisories(incoming, previous, { now = new Date(), retentionDays = 30 } = {}) {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 30;
  const cutoff = now.getTime() - days * 864e5;
  const byId = new Map();
  for (const item of [...(previous || []), ...(incoming || [])]) {
    if (item?.source !== 'checkpoint' || !item.id || !item.publishedAt) continue;
    const when = Date.parse(item.publishedAt);
    if (Number.isNaN(when) || when < cutoff) continue;
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) => String(right.publishedAt).localeCompare(String(left.publishedAt)));
}

export async function retrieveCheckpointAdvisories({ http, feedUrl = CHECKPOINT_ADVISORY_FEED } = {}) {
  const payload = await http.json(feedUrl, { label: 'Check Point advisories', timeoutMs: 30000 });
  if (!Array.isArray(payload)) throw new Error('Check Point advisories returned malformed JSON');
  return {
    advisories: selectCheckpointAdvisories(payload),
    sourceLabel: 'Check Point advisories',
    rawCount: payload.length
  };
}
