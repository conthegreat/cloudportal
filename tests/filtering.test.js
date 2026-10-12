import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { feedBlockedInBrowser, overallStatus, providerStatus, statusFromEvents } from '../assets/status-model.js';
import { decideInclusion } from '../scripts/filter.js';
import { createEvent } from '../scripts/lib/event.js';
import { parseRssItems } from '../scripts/lib/rss.js';
import { buildMockDocument } from '../scripts/mock-data.js';
import { classifyAwsRssItem, extractAwsRegions } from '../scripts/providers/aws.js';
import { classifyAzureRssItem, classifyAzureServiceHealthEvent } from '../scripts/providers/azure.js';
import { extractAzureRegions } from '../scripts/providers/azure-regions.js';
import { ciscoSignals, classifyCiscoEvent } from '../scripts/providers/cisco-umbrella.js';
import { classifyCloudflareEvent } from '../scripts/providers/cloudflare.js';
import { classifyGcpIncident, classifyGcpPersonalizedEvent } from '../scripts/providers/gcp.js';
import { buildComponentIndex } from '../scripts/providers/statuspage.js';
import { classifySynturaItem } from '../scripts/providers/syntura.js';

const config = JSON.parse(fs.readFileSync(new URL('../config/providers.json', import.meta.url)));
const now = new Date('2026-10-12T12:00:00.000Z');
const settings = {
  now,
  recentlyResolvedHours: config.recentlyResolvedHours,
  maintenanceLookAheadDays: config.maintenanceLookAheadDays
};

function event(partial) {
  return createEvent({
    provider: 'Azure',
    sourceProvider: 'azure',
    eventType: 'incident',
    status: 'investigating',
    severity: 'degraded',
    startedAt: '2026-10-12T10:00:00.000Z',
    updatedAt: '2026-10-12T11:00:00.000Z',
    title: 'Example',
    ...partial
  });
}

function inclusion(partial, providerId = 'azure') {
  return decideInclusion(event({ sourceProvider: providerId, ...partial }), config.providers[providerId], settings);
}

test('missing location is not treated as global', () => {
  const decision = inclusion({ id: 'missing', regions: [], locations: [], isGlobal: false });
  assert.equal(decision.included, false);
  assert.match(decision.inclusionReason, /unspecified/i);
});

test('explicit global Azure event is included and an East Asia event is not', () => {
  const globalEvent = inclusion({ id: 'global', isGlobal: true, title: 'Non-regional identity incident' });
  const asia = inclusion({ id: 'asia', regions: ['eastasia'], title: 'East Asia only' });
  const both = inclusion({ id: 'both', regions: ['uksouth', 'eastasia'] });
  assert.equal(globalEvent.included, true);
  assert.equal(globalEvent.badges.includes('Global'), true);
  assert.equal(asia.included, false);
  assert.equal(both.included, true);
  assert.deepEqual(both.matchedRegions, ['uksouth']);
  assert.match(both.inclusionReason, /UK South/);
});

test('resolved events follow the retention window', () => {
  const recent = inclusion({
    id: 'recent',
    regions: ['ukwest'],
    status: 'resolved',
    endedAt: '2026-10-12T09:00:00.000Z'
  });
  const old = inclusion({
    id: 'old',
    regions: ['uksouth'],
    status: 'resolved',
    endedAt: '2026-10-08T09:00:00.000Z'
  });
  assert.equal(recent.included, true);
  assert.equal(old.included, false);
  assert.match(old.inclusionReason, /retention/i);
});

test('maintenance outside the look-ahead window is excluded', () => {
  const far = inclusion({
    id: 'far',
    sourceProvider: 'ciscoUmbrella',
    provider: 'Cisco Umbrella',
    eventType: 'maintenance',
    status: 'scheduled',
    severity: 'maintenance',
    regions: ['eu'],
    scheduledFor: '2026-12-20T00:00:00.000Z',
    scheduledUntil: '2026-12-20T04:00:00.000Z'
  }, 'ciscoUmbrella');
  assert.equal(far.included, false);
  assert.match(far.inclusionReason, /look-ahead/i);
});

test('mock scenarios include the configured scope and exclude unrelated regions', () => {
  const document = buildMockDocument(config, now);
  const byId = Object.fromEntries(document.events.map((item) => [item.id, item]));
  assert.equal(document.mock, true);
  assert.match(document.mockNotice, /fictional/i);
  assert.equal(byId['mock-azure-uksouth'].included, true);
  assert.equal(byId['mock-azure-asia'].included, false);
  assert.equal(byId['mock-aws-london'].included, true);
  assert.equal(byId['mock-aws-us'].included, false);
  assert.equal(byId['mock-cisco-global'].included, true);
  assert.equal(byId['mock-cisco-eu-maint'].included, true);
  assert.equal(byId['mock-cisco-apac-maint'].included, false);
  assert.match(byId['mock-cisco-apac-maint'].inclusionReason, /blocked/i);
  assert.equal(byId['mock-cloudflare-lhr'].included, true);
  assert.equal(byId['mock-cloudflare-lhr'].badges.includes('London LHR'), true);
  assert.equal(byId['mock-cloudflare-sin'].included, false);
  assert.equal(byId['mock-syntura-maint'].included, true);
  assert.match(byId['mock-syntura-maint'].inclusionReason, /allow-list/i);
  assert.equal(byId['mock-gcp-cached'].included, true);
  assert.equal(byId['mock-resolved-recent'].included, true);
  assert.equal(byId['mock-resolved-old'].included, false);
  assert.equal(document.providers.gcp.stale, true);
  assert.equal(document.providers.gcp.hasCache, true);
  assert.equal(document.providers['example-empty'].hasCache, false);
  assert.equal(document.providers['example-empty'].stale, true);
  assert.equal(providerStatus([byId['mock-gcp-cached']], document.providers.gcp), 'degraded');
  assert.equal(providerStatus([], document.providers['example-empty']), 'unknown');
});

test('a browser-blocked feed with a saved snapshot stays on that snapshot', () => {
  const blocked = {
    hasCache: true,
    stale: true,
    error: 'Public Azure Status cannot be read from this browser',
    lastSuccess: '2026-10-12T12:34:29.538Z'
  };
  assert.equal(feedBlockedInBrowser(blocked), true);
  assert.equal(feedBlockedInBrowser({ ...blocked, hasCache: false }), false);
  assert.equal(feedBlockedInBrowser({ hasCache: true, stale: true, error: 'Public Azure Status timed out' }), false);
  assert.equal(providerStatus([], blocked), 'operational');
});

test('overall status does not claim operational when a provider has no cache', () => {
  assert.equal(overallStatus(['operational', 'unknown']), 'unknown');
  assert.equal(overallStatus(['major', 'unknown']), 'major');
  assert.equal(overallStatus(['operational', 'maintenance']), 'maintenance');
  assert.equal(statusFromEvents([]), 'operational');
});

test('RSS items and Azure region phrases are parsed', () => {
  const items = parseRssItems(`<?xml version="1.0"?><rss><channel><item>
    <title><![CDATA[Active issue in UK South &amp; UK West]]></title>
    <link>https://azure.status.microsoft/en-gb/status</link>
    <description>Impact in East Asia is not the only scope. UK South is affected.</description>
    <pubDate>Mon, 12 Oct 2026 09:00:00 Z</pubDate>
    <guid>https://example.test/azure-1</guid>
  </item></channel></rss>`);
  assert.equal(items.length, 1);
  assert.match(items[0].title, /UK South & UK West/);
  assert.deepEqual(extractAzureRegions(items[0].title), ['uksouth', 'ukwest']);
  const classified = classifyAzureRssItem(items[0]);
  assert.equal(classified.isGlobal, false);
  assert.equal(classified.regions.includes('uksouth'), true);
  assert.equal(classified.regions.includes('eastasia'), true);
});

test('Azure Service Health keeps UK South and drops subscription details', () => {
  const classified = classifyAzureServiceHealthEvent({
    name: 'TRACK-1',
    properties: {
      eventType: 'ServiceIssue',
      status: 'Active',
      level: 'Error',
      title: 'Virtual machines in UK South',
      summary: 'Investigation continues.',
      impactStartTime: '2026-10-12T08:00:00Z',
      lastUpdateTime: '2026-10-12T09:00:00Z',
      impact: [{ impactedService: 'Virtual Machines', impactedRegions: [{ impactedRegion: 'UK South' }] }]
    }
  });
  assert.equal(classified.regions.includes('uksouth'), true);
  assert.equal(JSON.stringify(classified).includes('subscription'), false);
});

test('AWS public items keep London and reject a US-only scope', () => {
  assert.deepEqual(extractAwsRegions('problem in eu-west-2 and us-east-1'), ['eu-west-2', 'us-east-1']);
  const london = classifyAwsRssItem({
    title: 'Service disruption: Increased Error Rates',
    description: 'The Europe (London) (eu-west-2) Region is affected.',
    guid: 'https://status.aws.amazon.com/#ec2-eu-west-2_123',
    pubDate: 'Mon, 12 Oct 2026 10:00:00 GMT'
  }, config.providers.aws);
  const usOnly = classifyAwsRssItem({
    title: 'Service disruption: Increased Error Rates',
    description: 'N. Virginia (us-east-1) only.',
    guid: 'https://status.aws.amazon.com/#ec2-us-east-1_456',
    pubDate: 'Mon, 12 Oct 2026 10:00:00 GMT'
  }, config.providers.aws);
  const route = classifyAwsRssItem({
    title: 'Informational message',
    description: 'Amazon Route 53 name servers are affected globally.',
    guid: 'https://status.aws.amazon.com/#amazon-route53_789',
    pubDate: 'Mon, 12 Oct 2026 10:00:00 GMT'
  }, config.providers.aws);
  const unspecified = classifyAwsRssItem({
    title: 'Informational message',
    description: 'An update is available.',
    guid: 'https://status.aws.amazon.com/#mystery-service_111',
    pubDate: 'Mon, 12 Oct 2026 10:00:00 GMT'
  }, config.providers.aws);
  assert.equal(decideInclusion(london, config.providers.aws, settings).included, true);
  assert.equal(decideInclusion(usOnly, config.providers.aws, settings).included, false);
  assert.equal(route.isGlobal, true);
  assert.equal(decideInclusion(route, config.providers.aws, settings).included, true);
  assert.equal(unspecified.isGlobal, false);
  assert.equal(decideInclusion(unspecified, config.providers.aws, settings).included, false);
});

test('Google Cloud uses structured locations and does not invent a global scope', () => {
  const london = classifyGcpIncident({
    id: 'abc',
    external_desc: 'Compute Engine issue',
    begin: '2026-10-12T09:00:00Z',
    modified: '2026-10-12T10:00:00Z',
    severity: 'medium',
    status_impact: 'SERVICE_DISRUPTION',
    currently_affected_locations: [{ id: 'europe-west2', title: 'London' }],
    affected_products: [{ title: 'Compute Engine', id: 'gce' }],
    updates: []
  }, now);
  const empty = classifyGcpIncident({
    id: 'def',
    external_desc: 'Customers may see errors',
    begin: '2026-10-12T09:00:00Z',
    modified: '2026-10-12T10:00:00Z',
    status_impact: 'SERVICE_DISRUPTION',
    updates: []
  }, now);
  const personalised = classifyGcpPersonalizedEvent({
    name: 'projects/example/locations/global/events/evt1',
    title: 'Packet loss',
    description: 'Investigation continues.',
    state: 'ACTIVE',
    detailedState: 'CONFIRMED',
    relevance: 'IMPACTED',
    startTime: '2026-10-12T09:00:00Z',
    updateTime: '2026-10-12T10:00:00Z',
    eventImpacts: [{ product: { productName: 'Compute Engine', id: 'gce' }, location: { locationName: 'europe-west2' } }]
  });
  assert.equal(decideInclusion(london, config.providers.gcp, settings).included, true);
  assert.equal(empty.isGlobal, false);
  assert.equal(decideInclusion(empty, config.providers.gcp, settings).included, false);
  assert.equal(decideInclusion(personalised, config.providers.gcp, settings).included, true);
});

test('Cisco keeps global and EU scope and drops an APAC-only maintenance', () => {
  const index = buildComponentIndex([
    { id: 'global', name: 'Umbrella Global', group: true },
    { id: 'api', name: 'API', group_id: 'global' },
    { id: 'asia', name: 'Umbrella Asia', group: true },
    { id: 'dns', name: 'DNS', group_id: 'asia' }
  ]);
  const globalIssue = classifyCiscoEvent({
    id: 'g1',
    name: 'Intermittent API failures',
    status: 'investigating',
    impact: 'major',
    started_at: '2026-10-12T11:00:00.000Z',
    updated_at: '2026-10-12T11:30:00.000Z',
    incident_updates: [{ created_at: '2026-10-12T11:30:00.000Z', body: 'Umbrella Global is affected.' }],
    components: [{ id: 'api', name: 'API' }]
  }, index, 'incident');
  const euMaint = classifyCiscoEvent({
    id: 'e1',
    name: 'Cisco Umbrella - API, Umbrella Global - EU App Discovery',
    status: 'scheduled',
    impact: 'maintenance',
    scheduled_for: '2026-10-17T16:00:00.000Z',
    scheduled_until: '2026-10-17T20:00:00.000Z',
    updated_at: '2026-10-12T09:00:00.000Z',
    incident_updates: [],
    components: [{ id: 'api', name: 'API' }]
  }, index, 'maintenance');
  const apac = classifyCiscoEvent({
    id: 'a1',
    name: 'Umbrella APAC DNS maintenance',
    status: 'scheduled',
    impact: 'maintenance',
    scheduled_for: '2026-10-14T00:00:00.000Z',
    scheduled_until: '2026-10-14T04:00:00.000Z',
    updated_at: '2026-10-12T09:00:00.000Z',
    incident_updates: [{ created_at: '2026-10-12T09:00:00.000Z', body: 'This window is limited to APAC.' }],
    components: [{ id: 'dns', name: 'DNS' }]
  }, index, 'maintenance');
  const mixed = ciscoSignals('Umbrella Global DNS issue also seen in Asia');
  assert.equal(decideInclusion(globalIssue, config.providers.ciscoUmbrella, settings).included, true);
  assert.equal(decideInclusion(euMaint, config.providers.ciscoUmbrella, settings).included, true);
  assert.equal(decideInclusion(apac, config.providers.ciscoUmbrella, settings).included, false);
  assert.equal(mixed.isGlobal, true);
  assert.equal(mixed.regions.includes('asia'), true);
});

test('Cloudflare uses component locations rather than title keywords alone', () => {
  const index = buildComponentIndex([
    { id: 'eu', name: 'Europe', group: true },
    { id: 'lhr', name: 'London, United Kingdom - (LHR)', group_id: 'eu' },
    { id: 'sin', name: 'Singapore - (SIN)', group_id: 'eu' },
    { id: 'platform', name: 'Cloudflare Sites and Services', group: true },
    { id: 'dns', name: 'Authoritative DNS', group_id: 'platform' }
  ]);
  const base = {
    status: 'scheduled',
    impact: 'maintenance',
    scheduled_for: '2026-10-13T15:00:00.000Z',
    scheduled_until: '2026-10-13T19:00:00.000Z',
    updated_at: '2026-10-12T09:00:00.000Z',
    incident_updates: []
  };
  const london = classifyCloudflareEvent({ ...base, id: 'lhr1', name: 'LHR on 2026-10-13', components: [{ id: 'lhr' }] }, index, 'maintenance', config.providers.cloudflare);
  const singapore = classifyCloudflareEvent({ ...base, id: 'sin1', name: 'SIN on 2026-10-13', components: [{ id: 'sin' }] }, index, 'maintenance', config.providers.cloudflare);
  const both = classifyCloudflareEvent({ ...base, id: 'both1', name: 'Multiple sites', components: [{ id: 'lhr' }, { id: 'sin' }] }, index, 'maintenance', config.providers.cloudflare);
  const dns = classifyCloudflareEvent({
    id: 'dns1',
    name: 'Authoritative DNS errors',
    status: 'investigating',
    impact: 'major',
    started_at: '2026-10-12T11:00:00.000Z',
    updated_at: '2026-10-12T11:10:00.000Z',
    incident_updates: [],
    components: [{ id: 'dns' }]
  }, index, 'incident', config.providers.cloudflare);
  const coloScoped = classifyCloudflareEvent({
    id: 'lax1',
    name: 'Elevated errors in Los Angeles',
    status: 'investigating',
    impact: 'minor',
    started_at: '2026-10-12T11:00:00.000Z',
    updated_at: '2026-10-12T11:10:00.000Z',
    incident_updates: [],
    components: [{ id: 'sin' }, { id: 'dns' }]
  }, index, 'incident', config.providers.cloudflare);
  assert.equal(decideInclusion(london, config.providers.cloudflare, settings).included, true);
  assert.equal(decideInclusion(singapore, config.providers.cloudflare, settings).included, false);
  assert.equal(decideInclusion(both, config.providers.cloudflare, settings).included, true);
  assert.equal(dns.isGlobal, true);
  assert.equal(decideInclusion(dns, config.providers.cloudflare, settings).included, true);
  assert.equal(coloScoped.isGlobal, false);
  assert.equal(decideInclusion(coloScoped, config.providers.cloudflare, settings).included, false);
  const china = classifyCloudflareEvent({
    id: 'cn1',
    name: 'Elevated Errors in China Network Colos',
    status: 'identified',
    impact: 'minor',
    started_at: '2026-10-12T11:00:00.000Z',
    updated_at: '2026-10-12T11:10:00.000Z',
    incident_updates: [],
    components: [{ id: 'china' }]
  }, buildComponentIndex([
    { id: 'platform', name: 'Cloudflare Sites and Services', group: true },
    { id: 'china', name: 'China Network', group_id: 'platform' }
  ]), 'incident', config.providers.cloudflare);
  assert.equal(china.isGlobal, false);
  assert.equal(decideInclusion(china, config.providers.cloudflare, settings).included, false);
});

test('Syntura drops staff fields and honours a later allow-list', () => {
  const item = classifySynturaItem({
    uuid: '11111111-1111-1111-1111-111111111111',
    published: true,
    title: 'Core maintenance <script>alert(1)</script>',
    startDate: '2026-10-15T19:00:00.000000Z',
    endDate: '2026-10-15T21:00:00.000000Z',
    content: '<p>No customer impact is expected.</p>',
    type: { name: 'Planned Works' },
    status: { name: 'Planned' },
    components: [{ title: 'Core Network' }],
    locations: [{ code: 'THN', name: 'Telehouse North' }],
    updates: [],
    times: { created: '2026-10-01T00:00:00.000000Z', updated: '2026-10-01T00:00:00.000000Z' },
    adminuser: { firstName: 'Hidden', lastName: 'Person', md5: 'secret' }
  }, now);
  assert.equal(JSON.stringify(item).includes('Hidden'), false);
  assert.equal(JSON.stringify(item).includes('secret'), false);
  assert.equal(item.title.includes('script'), false);
  const open = decideInclusion(item, config.providers.syntura, settings);
  assert.equal(open.included, true);
  const restricted = decideInclusion(item, {
    ...config.providers.syntura,
    allowedLocations: ['LD8'],
    includeWhenUnconfigured: true
  }, settings);
  assert.equal(restricted.included, false);
});
