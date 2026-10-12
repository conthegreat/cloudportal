import { decideInclusion } from './filter.js';
import { createEvent } from './lib/event.js';

function iso(now, hours) {
  return new Date(now.getTime() + hours * 36e5).toISOString();
}

function build(partial, config, now) {
  return decideInclusion(createEvent(partial), config.providers[partial.sourceProvider], {
    now,
    recentlyResolvedHours: config.recentlyResolvedHours,
    maintenanceLookAheadDays: config.maintenanceLookAheadDays
  });
}

export function buildMockDocument(config, now = new Date()) {
  const events = [
    build({
      id: 'mock-azure-uksouth',
      provider: 'Azure',
      sourceProvider: 'azure',
      eventType: 'incident',
      title: 'MOCK: Storage latency in UK South',
      status: 'investigating',
      severity: 'degraded',
      affectedServices: ['Storage'],
      regions: ['uksouth'],
      startedAt: iso(now, -2),
      updatedAt: iso(now, -0.3),
      summary: 'MOCK fictional event. A subset of storage transactions in UK South is slower than normal.',
      sourceUrl: 'https://azure.status.microsoft/en-gb/status'
    }, config, now),
    build({
      id: 'mock-azure-asia',
      provider: 'Azure',
      sourceProvider: 'azure',
      eventType: 'incident',
      title: 'MOCK: Compute outage in East Asia',
      status: 'identified',
      severity: 'major',
      affectedServices: ['Virtual Machines'],
      regions: ['eastasia'],
      startedAt: iso(now, -5),
      updatedAt: iso(now, -1),
      summary: 'MOCK fictional event limited to East Asia.',
      sourceUrl: 'https://azure.status.microsoft/en-gb/status'
    }, config, now),
    build({
      id: 'mock-aws-london',
      provider: 'Amazon Web Services',
      sourceProvider: 'aws',
      eventType: 'incident',
      title: 'MOCK: Service disruption in Europe (London)',
      status: 'identified',
      severity: 'major',
      affectedServices: ['ec2'],
      regions: ['eu-west-2'],
      startedAt: iso(now, -1),
      updatedAt: iso(now, -0.2),
      summary: 'MOCK fictional outage in eu-west-2.',
      sourceUrl: 'https://health.aws.amazon.com/health/status'
    }, config, now),
    build({
      id: 'mock-aws-us',
      provider: 'Amazon Web Services',
      sourceProvider: 'aws',
      eventType: 'incident',
      title: 'MOCK: Service disruption in US East',
      status: 'investigating',
      severity: 'major',
      affectedServices: ['ec2'],
      regions: ['us-east-1'],
      startedAt: iso(now, -3),
      updatedAt: iso(now, -2),
      summary: 'MOCK fictional event limited to us-east-1.',
      sourceUrl: 'https://health.aws.amazon.com/health/status'
    }, config, now),
    build({
      id: 'mock-cisco-global',
      provider: 'Cisco Umbrella',
      sourceProvider: 'ciscoUmbrella',
      eventType: 'incident',
      title: 'MOCK: Umbrella Global DNS resolution errors',
      status: 'investigating',
      severity: 'partial',
      affectedServices: ['DNS'],
      isGlobal: true,
      startedAt: iso(now, -0.5),
      updatedAt: iso(now, -0.1),
      summary: 'MOCK fictional global Umbrella DNS incident.',
      sourceUrl: 'https://status.umbrella.cisco.com/'
    }, config, now),
    build({
      id: 'mock-cisco-eu-maint',
      provider: 'Cisco Umbrella',
      sourceProvider: 'ciscoUmbrella',
      eventType: 'maintenance',
      title: 'MOCK: Umbrella EU API maintenance',
      status: 'scheduled',
      severity: 'maintenance',
      affectedServices: ['API'],
      regions: ['eu'],
      scheduledFor: iso(now, 72),
      scheduledUntil: iso(now, 76),
      startedAt: iso(now, -24),
      updatedAt: iso(now, -24),
      summary: 'MOCK fictional planned maintenance for Umbrella EU.',
      sourceUrl: 'https://status.umbrella.cisco.com/'
    }, config, now),
    build({
      id: 'mock-cisco-apac-maint',
      provider: 'Cisco Umbrella',
      sourceProvider: 'ciscoUmbrella',
      eventType: 'maintenance',
      title: 'MOCK: Umbrella APAC roaming-client maintenance',
      status: 'scheduled',
      severity: 'maintenance',
      affectedServices: ['Roaming client'],
      regions: ['apac'],
      scheduledFor: iso(now, 48),
      scheduledUntil: iso(now, 52),
      startedAt: iso(now, -12),
      updatedAt: iso(now, -12),
      summary: 'MOCK fictional maintenance limited to APAC.',
      sourceUrl: 'https://status.umbrella.cisco.com/'
    }, config, now),
    build({
      id: 'mock-cloudflare-lhr',
      provider: 'Cloudflare',
      sourceProvider: 'cloudflare',
      eventType: 'maintenance',
      title: 'MOCK: London (LHR) network maintenance',
      status: 'in_progress',
      severity: 'maintenance',
      affectedServices: ['Network'],
      locations: ['LHR'],
      scheduledFor: iso(now, -0.5),
      scheduledUntil: iso(now, 1.5),
      startedAt: iso(now, -0.5),
      updatedAt: iso(now, -0.1),
      summary: 'MOCK fictional maintenance in the London data centre.',
      sourceUrl: 'https://www.cloudflarestatus.com/'
    }, config, now),
    build({
      id: 'mock-cloudflare-sin',
      provider: 'Cloudflare',
      sourceProvider: 'cloudflare',
      eventType: 'maintenance',
      title: 'MOCK: Singapore (SIN) network maintenance',
      status: 'scheduled',
      severity: 'maintenance',
      affectedServices: ['Network'],
      locations: ['SIN'],
      scheduledFor: iso(now, 24),
      scheduledUntil: iso(now, 28),
      startedAt: iso(now, -5),
      updatedAt: iso(now, -5),
      summary: 'MOCK fictional maintenance limited to Singapore.',
      sourceUrl: 'https://www.cloudflarestatus.com/'
    }, config, now),
    build({
      id: 'mock-syntura-maint',
      provider: 'Syntura, formerly hSo',
      sourceProvider: 'syntura',
      eventType: 'maintenance',
      title: 'MOCK: Syntura core network planned works',
      status: 'scheduled',
      severity: 'maintenance',
      affectedServices: ['Core Network'],
      locations: ['THN'],
      scheduledFor: iso(now, 120),
      scheduledUntil: iso(now, 122),
      startedAt: iso(now, -48),
      updatedAt: iso(now, -48),
      summary: 'MOCK fictional Syntura planned maintenance. The service allow-list is still empty.',
      sourceUrl: 'https://synturastatus.io/'
    }, config, now),
    build({
      id: 'mock-gcp-cached',
      provider: 'Google Cloud Platform',
      sourceProvider: 'gcp',
      eventType: 'incident',
      title: 'MOCK: Cached Compute Engine degradation in europe-west2',
      status: 'monitoring',
      severity: 'degraded',
      affectedServices: ['Compute Engine'],
      regions: ['europe-west2'],
      startedAt: iso(now, -4),
      updatedAt: iso(now, -3),
      summary: 'MOCK fictional cached incident retained after the Google Cloud feed failed.',
      sourceUrl: 'https://status.cloud.google.com/'
    }, config, now),
    build({
      id: 'mock-resolved-recent',
      provider: 'Azure',
      sourceProvider: 'azure',
      eventType: 'incident',
      title: 'MOCK: Resolved UK West packet loss',
      status: 'resolved',
      severity: 'degraded',
      affectedServices: ['Virtual Network'],
      regions: ['ukwest'],
      startedAt: iso(now, -8),
      updatedAt: iso(now, -3),
      endedAt: iso(now, -3),
      summary: 'MOCK fictional incident resolved within the retention window.',
      sourceUrl: 'https://azure.status.microsoft/en-gb/status'
    }, config, now),
    build({
      id: 'mock-resolved-old',
      provider: 'Azure',
      sourceProvider: 'azure',
      eventType: 'incident',
      title: 'MOCK: Old resolved UK South incident',
      status: 'resolved',
      severity: 'major',
      affectedServices: ['App Service'],
      regions: ['uksouth'],
      startedAt: iso(now, -96),
      updatedAt: iso(now, -72),
      endedAt: iso(now, -72),
      summary: 'MOCK fictional incident resolved outside the retention window.',
      sourceUrl: 'https://azure.status.microsoft/en-gb/status'
    }, config, now)
  ];

  function meta(id, name, extra) {
    const own = events.filter((event) => event.sourceProvider === id);
    return {
      id,
      name,
      sourceLabel: 'Mock data',
      statusPageUrl: config.providers[id]?.statusPageUrl || '',
      lastSuccess: extra.lastSuccess,
      stale: extra.stale,
      error: extra.error,
      hasCache: extra.hasCache,
      rawCount: own.length,
      includedCount: own.filter((event) => event.included).length,
      excludedCount: own.filter((event) => !event.included).length,
      exclusionReasons: {},
      warnings: []
    };
  }

  return {
    schemaVersion: 1,
    mock: true,
    mockNotice: 'Mock data. These events are fictional and are for layout testing. They are not live provider incidents.',
    organisation: config.organisation,
    dashboardTitle: config.dashboardTitle,
    timeZone: config.timeZone,
    generatedAt: now.toISOString(),
    refreshMinutes: config.refreshMinutes,
    maintenanceLookAheadDays: config.maintenanceLookAheadDays,
    recentlyResolvedHours: config.recentlyResolvedHours,
    providers: {
      azure: meta('azure', 'Microsoft Azure', { lastSuccess: now.toISOString(), stale: false, error: null, hasCache: true }),
      gcp: meta('gcp', 'Google Cloud Platform', { lastSuccess: iso(now, -6), stale: true, error: 'GCP status feed timed out', hasCache: true }),
      aws: meta('aws', 'Amazon Web Services', { lastSuccess: now.toISOString(), stale: false, error: null, hasCache: true }),
      ciscoUmbrella: meta('ciscoUmbrella', 'Cisco Umbrella', { lastSuccess: now.toISOString(), stale: false, error: null, hasCache: true }),
      cloudflare: meta('cloudflare', 'Cloudflare', { lastSuccess: now.toISOString(), stale: false, error: null, hasCache: true }),
      syntura: meta('syntura', 'Syntura, formerly hSo', { lastSuccess: now.toISOString(), stale: false, error: null, hasCache: true }),
      'example-empty': {
        id: 'example-empty',
        name: 'Example feed (mock only)',
        sourceLabel: 'Mock data',
        statusPageUrl: '',
        lastSuccess: null,
        stale: true,
        error: 'Status feed unavailable and no cached data',
        hasCache: false,
        rawCount: 0,
        includedCount: 0,
        excludedCount: 0,
        exclusionReasons: {},
        warnings: []
      }
    },
    events
  };
}
