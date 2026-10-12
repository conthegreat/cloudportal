import { safeHttpUrl, toPlainText, unique } from './text.js';

export function createEvent(partial) {
  return {
    id: String(partial.id || ''),
    provider: partial.provider,
    sourceProvider: partial.sourceProvider,
    eventType: partial.eventType === 'maintenance' ? 'maintenance' : 'incident',
    title: toPlainText(partial.title || 'Untitled event').slice(0, 240),
    status: partial.status || 'investigating',
    severity: partial.severity || 'minor',
    affectedServices: unique(partial.affectedServices),
    affectedComponents: unique(partial.affectedComponents),
    regions: unique(partial.regions),
    locations: unique(partial.locations),
    isGlobal: partial.isGlobal === true,
    startedAt: partial.startedAt || null,
    updatedAt: partial.updatedAt || null,
    endedAt: partial.endedAt || null,
    scheduledFor: partial.scheduledFor || null,
    scheduledUntil: partial.scheduledUntil || null,
    summary: toPlainText(partial.summary || ''),
    sourceUrl: safeHttpUrl(partial.sourceUrl),
    productOutOfScope: partial.productOutOfScope === true,
    included: false,
    inclusionReason: '',
    matchedRegions: [],
    matchedComponents: [],
    badges: []
  };
}
