import { daysUntil, hoursBetween } from './lib/time.js';
import { norm, unique } from './lib/text.js';

const BADGE_LABELS = {
  uksouth: 'UK South',
  ukwest: 'UK West',
  'eu-west-2': 'London (eu-west-2)',
  'europe-west2': 'London (europe-west2)',
  lhr: 'London LHR',
  'uk-london-1': 'UK South (London)',
  'uk-cardiff-1': 'UK West (Newport)',
  uk: 'UK',
  europe: 'Europe',
  eu: 'Europe',
  emea: 'Europe',
  global: 'Global'
};

export function badgeFor(code) {
  return BADGE_LABELS[norm(code)] || String(code);
}

function asSet(values) {
  return new Set((values || []).map((value) => norm(value)).filter(Boolean));
}

function finish(event, decision) {
  const badges = unique(decision.badges || []);
  return {
    ...event,
    productOutOfScope: undefined,
    included: decision.included,
    inclusionReason: decision.inclusionReason,
    matchedRegions: decision.matchedRegions || [],
    matchedComponents: decision.matchedComponents || [],
    badges
  };
}

function outsideRetention(event, settings, now) {
  const limit = Number(settings.recentlyResolvedHours ?? 24);
  if (event.eventType === 'maintenance') {
    if (event.status !== 'completed' && event.status !== 'resolved') return false;
    const ended = event.endedAt || event.scheduledUntil || event.updatedAt;
    return Boolean(ended) && hoursBetween(ended, now) > limit;
  }
  if (event.status !== 'resolved' && event.status !== 'completed') return false;
  const ended = event.endedAt || event.updatedAt || event.startedAt;
  return Boolean(ended) && hoursBetween(ended, now) > limit;
}

function outsideLookAhead(event, settings, now) {
  if (event.eventType !== 'maintenance') return false;
  if (event.status === 'in_progress' || event.status === 'completed' || event.status === 'resolved') return false;
  if (!event.scheduledFor) return false;
  return daysUntil(event.scheduledFor, now) > Number(settings.maintenanceLookAheadDays ?? 30);
}

function regionReason(event, labels) {
  const list = labels.join(', ');
  if (event.sourceProvider === 'azure') return `Affected Azure region: ${list}`;
  if (event.sourceProvider === 'aws') return `Affected AWS region: ${list}`;
  if (event.sourceProvider === 'gcp') return `Affected Google Cloud region: ${list}`;
  if (event.sourceProvider === 'cloudflare') return `Affected Cloudflare location: ${list}`;
  if (event.sourceProvider === 'oracle') return `Affected Oracle Cloud region: ${list}`;
  if (event.sourceProvider === 'govwifi') return 'GovWifi service';
  if (event.sourceProvider === 'ciscoUmbrella') return `Affected Cisco Umbrella scope: ${list}`;
  return `Affected location: ${list}`;
}

export function decideInclusion(event, providerConfig = {}, settings = {}) {
  const now = settings.now instanceof Date ? settings.now : new Date(settings.now || Date.now());
  if (outsideRetention(event, settings, now)) {
    return finish(event, {
      included: false,
      inclusionReason: `Resolved outside the ${settings.recentlyResolvedHours ?? 24} hour retention window`,
      matchedRegions: [],
      matchedComponents: [],
      badges: []
    });
  }
  if (outsideLookAhead(event, settings, now)) {
    return finish(event, {
      included: false,
      inclusionReason: `Maintenance starts outside the ${settings.maintenanceLookAheadDays ?? 30} day look-ahead window`,
      matchedRegions: [],
      matchedComponents: [],
      badges: []
    });
  }
  if (event.productOutOfScope) {
    return finish(event, {
      included: false,
      inclusionReason: 'Cisco product outside Umbrella scope',
      matchedRegions: [],
      matchedComponents: [],
      badges: []
    });
  }

  const allowedRegions = asSet(providerConfig.allowedRegions);
  const allowedLocations = asSet(providerConfig.allowedLocations);
  const allowedServices = asSet(providerConfig.allowedServices);
  const allowedComponents = asSet(providerConfig.allowedComponents);
  const blocked = asSet([...(providerConfig.blockedRegions || []), ...(providerConfig.blockedLocations || [])]);
  const regionTokens = unique([...(event.regions || []), ...(event.locations || [])]);
  const serviceTokens = unique([...(event.affectedServices || []), ...(event.affectedComponents || [])]);
  const matchedRegions = regionTokens.filter((token) => allowedRegions.has(norm(token)) || allowedLocations.has(norm(token)));
  const matchedComponents = serviceTokens.filter((token) => allowedServices.has(norm(token)) || allowedComponents.has(norm(token)));
  const explicitGlobal = event.isGlobal === true && providerConfig.includeGlobal !== false;
  const locationConfigured = allowedRegions.size > 0 || allowedLocations.size > 0;
  const serviceConfigured = allowedServices.size > 0 || allowedComponents.size > 0;
  const allowConfigured = locationConfigured || serviceConfigured;
  const blockedHits = regionTokens.filter((token) => blocked.has(norm(token)));
  const onlyBlocked = regionTokens.length > 0
    && blockedHits.length === regionTokens.length
    && matchedRegions.length === 0
    && !explicitGlobal;

  if (onlyBlocked) {
    return finish(event, {
      included: false,
      inclusionReason: 'Limited to a blocked region',
      matchedRegions,
      matchedComponents,
      badges: []
    });
  }

  if (explicitGlobal && (!serviceConfigured || matchedComponents.length > 0 || serviceTokens.length === 0)) {
    return finish(event, {
      included: true,
      inclusionReason: 'Explicitly global',
      matchedRegions,
      matchedComponents,
      badges: unique(['Global', ...matchedRegions.map(badgeFor)])
    });
  }

  if (matchedRegions.length) {
    if (serviceConfigured && matchedComponents.length === 0) {
      return finish(event, {
        included: false,
        inclusionReason: 'Region is allowed but the service is not in the service allow-list',
        matchedRegions,
        matchedComponents,
        badges: []
      });
    }
    const labels = matchedRegions.map(badgeFor);
    return finish(event, {
      included: true,
      inclusionReason: regionReason(event, labels),
      matchedRegions,
      matchedComponents,
      badges: labels
    });
  }

  if (matchedComponents.length && regionTokens.length === 0) {
    return finish(event, {
      included: true,
      inclusionReason: `Affected service: ${matchedComponents.join(', ')}`,
      matchedRegions,
      matchedComponents,
      badges: matchedComponents
    });
  }

  if (matchedComponents.length && regionTokens.length > 0) {
    return finish(event, {
      included: false,
      inclusionReason: 'Service match is limited to an unrelated region',
      matchedRegions,
      matchedComponents,
      badges: []
    });
  }

  if (regionTokens.length > 0) {
    if (!allowConfigured && providerConfig.includeWhenUnconfigured === true) {
      return finish(event, {
        included: true,
        inclusionReason: 'Allow-lists are empty, so this event is included until services are configured',
        matchedRegions,
        matchedComponents,
        badges: ['Allow-list not set']
      });
    }
    return finish(event, {
      included: false,
      inclusionReason: 'Limited to a region or location outside the allow-list',
      matchedRegions,
      matchedComponents,
      badges: []
    });
  }

  if (!allowConfigured && providerConfig.includeWhenUnconfigured === true) {
    return finish(event, {
      included: true,
      inclusionReason: 'Allow-lists are empty and the event has no location, so it is included until services are configured',
      matchedRegions,
      matchedComponents,
      badges: ['Allow-list not set']
    });
  }

  return finish(event, {
    included: false,
    inclusionReason: 'Location was unspecified and the event is not explicitly global',
    matchedRegions,
    matchedComponents,
    badges: []
  });
}
