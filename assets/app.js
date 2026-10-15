import { retainCheckpointAdvisories } from '../scripts/advisories/checkpoint.js';
import { retainCiscoAdvisories } from '../scripts/advisories/cisco-psirt.js';
import { collectStatus } from '../scripts/collect.js';
import {
  formatAge,
  formatDuration,
  formatLondon,
  formatRemaining,
  isCurrentIncident,
  isVisibleMaintenance,
  feedBlockedInBrowser,
  overallStatus,
  providerStatus,
  sortIncidents,
  sortMaintenance,
  statusLabel
} from './status-model.js';

const ORDER = ['azure', 'gcp', 'aws', 'oracle', 'ciscoUmbrella', 'cloudflare', 'govwifi', 'syntura', 'example-empty'];
const LETTERS = {
  azure: 'Az',
  gcp: 'G',
  aws: 'Aw',
  oracle: 'Or',
  ciscoUmbrella: 'Um',
  cloudflare: 'Cf',
  govwifi: 'Gw',
  syntura: 'Sy',
  'example-empty': 'Ex'
};

const ADVISORY_STORE = 'cisco-psirt-week';
const ADVISORY_DAYS = 7;
const CHECKPOINT_DAYS = 30;
const state = { mode: 'live', status: null, checkedAt: null, snapshotAt: null, freshness: 'pending' };
let refreshing = false;

const els = {
  title: document.querySelector('#dashboard-title'),
  overall: document.querySelector('#overall'),
  updated: document.querySelector('#updated'),
  schedule: document.querySelector('#schedule'),
  banners: document.querySelector('#banners'),
  cards: document.querySelector('#provider-cards'),
  ciscoAdvisories: document.querySelector('#cisco-advisories'),
  ciscoAdvisoryNote: document.querySelector('#cisco-advisory-note'),
  checkpointAdvisories: document.querySelector('#checkpoint-advisories'),
  checkpointAdvisoryNote: document.querySelector('#checkpoint-advisory-note'),
  incidents: document.querySelector('#incidents'),
  maintenance: document.querySelector('#maintenance'),
  resolved: document.querySelector('#resolved'),
  filter: document.querySelector('#filter-log'),
  live: document.querySelector('#live'),
  reload: document.querySelector('#reload'),
  checked: document.querySelector('#checked'),
  liveButton: document.querySelector('#show-live'),
  mockButton: document.querySelector('#show-mock'),
  loading: document.querySelector('#loading')
};

function h(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

function safeUrl(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href;
  } catch {
    return '';
  }
  return '';
}

function externalLink(url, text) {
  const href = safeUrl(url);
  if (!href) return h('span', { class: 'meta', text: 'No official link published' });
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, [
    document.createTextNode(text),
    h('span', { class: 'visually-hidden', text: ' (opens in a new tab)' })
  ]);
}

function chip(status, label = statusLabel(status)) {
  return h('span', { class: 'chip', 'data-status': status, text: label });
}

function advisoryChip(severity) {
  const status = { critical: 'major', high: 'partial', medium: 'degraded' }[severity] || 'unknown';
  const label = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', informational: 'Informational', unrated: 'Unrated' }[severity] || 'Unrated';
  return chip(status, label);
}

function isCheckpointAdvisory(item) {
  return item?.source === 'checkpoint';
}

function advisoryArticle(item, zone) {
  const checkpoint = isCheckpointAdvisory(item);
  const cves = item.cves || [];
  const shown = cves.slice(0, 3).join(', ');
  const extra = cves.length > 3 ? ` +${cves.length - 3} more` : '';
  const when = item.publishedAt ? formatLondon(item.publishedAt, zone) : 'Date not supplied';
  const title = item.url
    ? h('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer' }, [
      document.createTextNode(item.title),
      h('span', { class: 'visually-hidden', text: ' (opens in a new tab)' })
    ])
    : document.createTextNode(item.title);
  const meta = checkpoint || !shown ? when : `${shown}${extra} · ${when}`;
  return h('article', { class: 'advisory', 'data-severity': item.severity || 'unrated', 'data-source': checkpoint ? 'checkpoint' : 'cisco' }, [
    h('div', { class: 'advisory-top' }, [
      h('h3', {}, [title]),
      advisoryChip(item.severity)
    ]),
    checkpoint && item.summary ? h('p', { class: 'advisory-summary', text: item.summary }) : null,
    h('p', { class: 'meta', text: meta })
  ]);
}

function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('provider-icon');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', '48');
  rect.setAttribute('height', '48');
  rect.setAttribute('rx', '10');
  rect.setAttribute('fill', '#0c2340');
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', '24');
  text.setAttribute('y', '30');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('fill', '#f4f7fb');
  text.setAttribute('font-size', '16');
  text.setAttribute('font-family', 'Segoe UI, sans-serif');
  text.textContent = LETTERS[id] || 'S';
  svg.append(rect, text);
  return svg;
}

function renderAdvisoryGroup(container, note, items, zone, days, feed, mock) {
  if (!container) return;
  if (note) note.textContent = `Last ${days} days`;
  clear(container);
  const sorted = items
    .slice()
    .sort((left, right) => String(right.publishedAt || '').localeCompare(String(left.publishedAt || '')));
  if (sorted.length > 0) {
    for (const item of sorted) container.append(advisoryArticle(item, zone));
    return;
  }
  if (mock) {
    container.append(h('p', { class: 'empty', text: 'None in this preview.' }));
    return;
  }
  if (state.freshness === 'pending') return;
  container.append(h('p', { class: 'empty', text: feed?.stale ? 'Temporarily unavailable.' : 'None in this period.' }));
}

function renderAdvisories(status, zone) {
  const items = Array.isArray(status.advisories) ? status.advisories : [];
  const ciscoDays = status.advisoryFeed?.retentionDays || ADVISORY_DAYS;
  const checkpointDays = status.checkpointFeed?.retentionDays || CHECKPOINT_DAYS;
  renderAdvisoryGroup(
    els.ciscoAdvisories,
    els.ciscoAdvisoryNote,
    items.filter((item) => !isCheckpointAdvisory(item)),
    zone,
    ciscoDays,
    status.advisoryFeed,
    status.mock
  );
  renderAdvisoryGroup(
    els.checkpointAdvisories,
    els.checkpointAdvisoryNote,
    items.filter(isCheckpointAdvisory),
    zone,
    checkpointDays,
    status.checkpointFeed,
    status.mock
  );
}

function setChecked(text) {
  if (!els.checked) return;
  const value = text || '';
  els.checked.textContent = value;
  els.checked.hidden = value.length === 0;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function listOrEmpty(items, text) {
  if (items.length === 0) return [h('p', { class: 'empty', text })];
  return items;
}

function fact(term, value) {
  return h('div', {}, [h('dt', { text: term }), h('dd', { text: value || 'Not supplied' })]);
}

function badges(event) {
  const row = h('p', {});
  for (const badge of event.badges || []) row.append(h('span', { class: 'chip chip-badge', text: badge }));
  return row.childNodes.length ? row : null;
}

function eventArticle(event, zone, mode) {
  const zoneName = zone || 'Europe/London';
  const places = [...(event.regions || []), ...(event.locations || [])];
  const services = [...(event.affectedServices || []), ...(event.affectedComponents || [])];
  const facts = [
    fact('Provider', event.provider),
    fact('Status', event.status),
    fact('Severity', event.severity),
    fact('Service', [...new Set(services)].join(', ')),
    fact('Region or location', places.length ? places.join(', ') : (event.isGlobal ? 'Global' : 'Unspecified'))
  ];
  if (mode === 'maintenance') {
    facts.push(
      fact('Starts', formatLondon(event.scheduledFor, zoneName)),
      fact('Ends', formatLondon(event.scheduledUntil, zoneName)),
      fact('State', event.status),
      fact('Time remaining', formatRemaining(event)),
      fact('Expected duration', formatDuration(event.scheduledFor, event.scheduledUntil))
    );
  } else {
    facts.push(
      fact('Started', formatLondon(event.startedAt, zoneName)),
      fact('Last updated', formatLondon(event.updatedAt, zoneName))
    );
  }
  return h('article', { class: 'event', 'data-status': event.severity === 'maintenance' ? 'maintenance' : event.severity }, [
    h('div', { class: 'event-top' }, [
      h('h3', { text: event.title }),
      chip(event.severity === 'minor' ? 'degraded' : event.severity, event.severity === 'maintenance' ? 'Maintenance' : statusLabel(event.severity === 'minor' ? 'degraded' : event.severity))
    ]),
    badges(event),
    h('p', { class: 'reason', text: event.inclusionReason }),
    h('dl', { class: 'facts' }, facts),
    event.summary ? h('p', { class: 'summary', text: event.summary }) : null,
    externalLink(event.sourceUrl, 'View the official update')
  ]);
}

function providerCard(meta, events, zone) {
  const own = events.filter((event) => event.sourceProvider === meta.id && event.included);
  const status = providerStatus(own, meta);
  const incidents = own.filter(isCurrentIncident).length;
  const maintenance = own.filter((event) => event.eventType === 'maintenance' && (event.status === 'scheduled' || event.status === 'in_progress')).length;
  const children = [
    h('div', { class: 'card-top' }, [
      h('div', { class: 'identity' }, [
        icon(meta.id),
        h('div', {}, [
          h('h3', { text: meta.name }),
          h('p', { class: 'source', text: `Source: ${meta.sourceLabel || 'Unavailable'}` })
        ])
      ]),
      chip(status)
    ]),
    h('ul', { class: 'counts' }, [
      h('li', {}, [h('strong', { text: String(incidents) }), document.createTextNode(' Active incidents')]),
      h('li', {}, [h('strong', { text: String(maintenance) }), document.createTextNode(' Upcoming maintenance')])
    ]),
    h('p', { class: 'meta', text: meta.lastSuccess ? `Last successful retrieval ${formatLondon(meta.lastSuccess, zone)} (${formatAge(meta.lastSuccess)})` : 'No successful retrieval' })
  ];
  if (!feedBlockedInBrowser(meta) && meta.stale && meta.hasCache) {
    children.push(h('p', { class: 'warning', text: `Stale data. Showing the cached feed from ${formatAge(meta.lastSuccess)}. ${meta.error || ''}`.trim() }));
  }
  if (!meta.hasCache) {
    children.push(h('p', { class: 'warning', text: `Unknown. The feed is unavailable and there is no cached data. ${meta.error || ''}`.trim() }));
  }
  if (meta.statusPageUrl) children.push(externalLink(meta.statusPageUrl, 'Open the official status page'));
  return h('article', { class: 'card', 'data-status': status }, children);
}

function render(status) {
  const zone = status.timeZone || 'Europe/London';
  if (els.title && status.dashboardTitle) {
    els.title.textContent = status.dashboardTitle;
    document.title = status.dashboardTitle;
  }
  const providers = ORDER.map((id) => status.providers?.[id]).filter(Boolean);
  const events = Array.isArray(status.events) ? status.events : [];
  const statuses = providers.map((meta) => providerStatus(events.filter((event) => event.sourceProvider === meta.id && event.included), meta));
  const overall = overallStatus(statuses);
  clear(els.overall);
  els.overall.append(
    h('p', { class: 'meta', text: 'Overall status' }),
    chip(overall),
    h('p', { class: 'meta', text: 'Calculated from events in scope only.' })
  );
  const metas = Object.values(status.providers || {});
  const fresh = metas.filter((meta) => meta && !meta.stale && meta.hasCache);
  const failed = metas.filter((meta) => meta && (meta.stale || !meta.hasCache) && !feedBlockedInBrowser(meta));
  if (state.freshness === 'pending') {
    els.updated.textContent = 'Refreshing provider feeds…';
    setChecked('');
  } else if (state.freshness === 'live' && fresh.length > 0) {
    els.updated.textContent = `Provider data collected: ${formatLondon(status.generatedAt, zone)} (${formatAge(status.generatedAt)})`;
    setChecked(failed.length ? `A saved snapshot is still in use for ${failed.map((meta) => meta.name).join(', ')}.` : '');
  } else if (state.freshness === 'mock') {
    els.updated.textContent = `Mock data generated: ${formatLondon(status.generatedAt, zone)} (${formatAge(status.generatedAt)})`;
    setChecked('Mock scenarios are fictional and are not read from the providers.');
  } else {
    const when = state.snapshotAt || status.generatedAt;
    els.updated.textContent = `Saved snapshot: ${formatLondon(when, zone)} (${formatAge(when)})`;
    setChecked('The provider feeds could not be read just now.');
  }
  els.schedule.textContent = 'Reload reads the provider feeds in this browser. A saved snapshot is used only when a feed cannot be reached.';
  clear(els.banners);
  if (status.mock) {
    els.banners.append(h('p', { class: 'banner banner-mock', role: 'status', text: status.mockNotice || 'Mock data. These events are fictional.' }));
  }
  const stale = providers.filter((meta) => (meta.stale || !meta.hasCache) && !feedBlockedInBrowser(meta));
  if (stale.length) {
    els.banners.append(h('p', {
      class: 'banner banner-stale',
      role: 'status',
      text: `Some provider feeds are stale or unavailable: ${stale.map((meta) => meta.name).join(', ')}.`
    }));
  }
  clear(els.cards);
  for (const meta of providers) els.cards.append(providerCard(meta, events, zone));
  renderAdvisories(status, zone);
  const current = sortIncidents(events.filter(isCurrentIncident));
  const maintenance = sortMaintenance(events.filter(isVisibleMaintenance));
  const resolved = sortIncidents(events.filter((event) => event.included && event.eventType === 'incident' && event.status === 'resolved'));
  clear(els.incidents);
  for (const node of listOrEmpty(current.map((event) => eventArticle(event, zone, 'incident')), 'No current incidents in scope.')) els.incidents.append(node);
  clear(els.maintenance);
  for (const node of listOrEmpty(maintenance.map((event) => eventArticle(event, zone, 'maintenance')), 'No current or upcoming maintenance in scope.')) els.maintenance.append(node);
  clear(els.resolved);
  const resolvedHeading = document.querySelector('#resolved-heading');
  if (resolvedHeading) resolvedHeading.textContent = `Resolved in the last ${status.recentlyResolvedHours || 24} hours`;
  for (const node of listOrEmpty(resolved.map((event) => eventArticle(event, zone, 'incident')), 'No incidents in scope were resolved in the retention window.')) els.resolved.append(node);
  const excluded = events.filter((event) => !event.included);
  const summary = els.filter.querySelector('summary') || h('summary');
  clear(els.filter);
  summary.textContent = `Excluded events (${excluded.length})`;
  els.filter.append(summary);
  const shown = excluded.slice(0, 40);
  const list = h('ul', { class: 'excluded' });
  for (const event of shown) {
    list.append(h('li', { text: `${event.provider}: ${event.title}. ${event.inclusionReason}` }));
  }
  els.filter.append(list);
  if (excluded.length > shown.length) {
    els.filter.append(h('p', { class: 'meta', text: `And ${excluded.length - shown.length} more excluded events in the status file.` }));
  }
  if (els.loading) els.loading.hidden = true;
}

async function load() {
  const file = state.mode === 'mock' ? 'data/mock-status.json' : 'data/status.json';
  try {
    const response = await fetch(`${file}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Status file returned HTTP ${response.status}`);
    const loaded = await response.json();
    if (!loaded || !Array.isArray(loaded.events) || !loaded.providers) throw new Error('Status file has an unexpected shape');
    const status = state.mode === 'live' ? withStoredAdvisories(loaded) : loaded;
    state.status = status;
    state.snapshotAt = status.generatedAt || null;
    state.freshness = state.mode === 'live' ? 'pending' : 'mock';
    state.checkedAt = new Date().toISOString();
    render(status);
    if (state.mode === 'live') await refreshFromProviders();
    else els.live.textContent = 'Mock scenarios loaded. These events are fictional.';
  } catch (error) {
    clear(els.banners);
    els.banners.append(h('p', { class: 'banner banner-error', role: 'alert', text: 'The saved snapshot could not be read. Trying the provider feeds.' }));
    els.live.textContent = 'The saved snapshot could not be read.';
    console.error(error?.message || 'status load failed');
    if (state.mode === 'live') await refreshFromProviders();
  } finally {
    els.liveButton.setAttribute('aria-pressed', state.mode === 'live' ? 'true' : 'false');
    els.mockButton.setAttribute('aria-pressed', state.mode === 'mock' ? 'true' : 'false');
  }
}

async function refreshFromProviders() {
  if (state.mode !== 'live' || refreshing) return;
  refreshing = true;
  els.reload.disabled = true;
  state.freshness = 'pending';
  els.updated.textContent = 'Refreshing provider feeds…';
  setChecked('');
  try {
    const configResponse = await fetch(`config/providers.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!configResponse.ok) throw new Error('Config could not be read');
    const config = await configResponse.json();
    const published = await readSnapshot();
    if (published?.generatedAt) state.snapshotAt = published.generatedAt;
    const status = await collectStatus({
      config,
      previous: withSnapshotAdvisories(withStoredAdvisories(withNewerPublishedProvider(state.status, published, 'azure')), published),
      env: {}
    });
    rememberAdvisories(status);
    const freshCount = Object.values(status.providers).filter((meta) => !meta.stale && meta.hasCache).length;
    state.status = status;
    state.checkedAt = new Date().toISOString();
    state.freshness = freshCount > 0 ? 'live' : 'snapshot';
    render(status);
    const stale = Object.values(status.providers).filter((meta) => (meta.stale || !meta.hasCache) && !feedBlockedInBrowser(meta)).map((meta) => meta.name);
    const overall = els.overall.querySelector('.chip')?.textContent || 'Unknown';
    els.live.textContent = freshCount === 0
      ? 'The provider feeds could not be read. Showing the saved snapshot.'
      : stale.length
        ? `Feeds refreshed just now. Overall status is ${overall}. A saved copy is still in use for ${stale.join(', ')}.`
        : `Feeds refreshed just now. Overall status is ${overall}.`;
  } catch (error) {
    state.freshness = 'snapshot';
    if (state.status) render(withStoredAdvisories(state.status) || state.status);
    else setChecked('The provider feeds could not be refreshed. There is no saved snapshot.');
    els.live.textContent = 'The provider feeds could not be refreshed.';
    console.error(error?.message || 'refresh failed');
  } finally {
    refreshing = false;
    els.reload.disabled = false;
  }
}

function readAdvisoryStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ADVISORY_STORE) || 'null');
    if (!parsed || !Array.isArray(parsed.advisories)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function rememberAdvisories(status) {
  if (!status || status.mock || !Array.isArray(status.advisories)) return;
  const cisco = status.advisories.filter((item) => !isCheckpointAdvisory(item));
  if (status.advisoryFeed?.stale && cisco.length === 0) return;
  localStorage.setItem(ADVISORY_STORE, JSON.stringify({
    advisories: cisco,
    lastSuccess: status.advisoryFeed?.lastSuccess || null
  }));
}

function withStoredAdvisories(status) {
  const stored = readAdvisoryStore();
  const base = status && status.mock !== true ? status : null;
  const checkpoint = (base?.advisories || []).filter(isCheckpointAdvisory);
  if (!stored && !base?.advisories) return base;
  const cisco = retainCiscoAdvisories(
    (base?.advisories || []).filter((item) => !isCheckpointAdvisory(item)),
    stored?.advisories || [],
    { now: new Date(), retentionDays: ADVISORY_DAYS }
  );
  const advisories = [...cisco, ...checkpoint];
  if (!base) {
    return cisco.length ? {
      mock: false,
      advisories: cisco,
      advisoryFeed: {
        sourceLabel: 'Cisco PSIRT',
        lastSuccess: stored?.lastSuccess || null,
        stale: true,
        error: null,
        hasCache: true,
        shownCount: cisco.length,
        retentionDays: ADVISORY_DAYS
      }
    } : null;
  }
  if (!advisories.length && !(base.advisories || []).length) return base;
  return {
    ...base,
    advisories,
    advisoryFeed: base.advisoryFeed || (cisco.length ? {
      sourceLabel: 'Cisco PSIRT',
      lastSuccess: stored?.lastSuccess || null,
      stale: true,
      error: null,
      hasCache: cisco.length > 0,
      shownCount: cisco.length,
      retentionDays: ADVISORY_DAYS
    } : base.advisoryFeed)
  };
}

function withSnapshotAdvisories(status, published) {
  const base = status && status.mock !== true ? status : null;
  const publishedCheckpoint = (published?.advisories || []).filter(isCheckpointAdvisory);
  const currentCheckpoint = (base?.advisories || []).filter(isCheckpointAdvisory);
  if (!publishedCheckpoint.length && !published?.checkpointFeed) return base;
  const days = Number(published?.checkpointFeed?.retentionDays) > 0
    ? Number(published.checkpointFeed.retentionDays)
    : CHECKPOINT_DAYS;
  const checkpoint = retainCheckpointAdvisories(publishedCheckpoint, currentCheckpoint, {
    now: new Date(),
    retentionDays: days
  });
  const cisco = (base?.advisories || []).filter((item) => !isCheckpointAdvisory(item));
  const currentAt = Date.parse(base?.checkpointFeed?.lastSuccess || 0);
  const publishedAt = Date.parse(published?.checkpointFeed?.lastSuccess || 0);
  const checkpointFeed = publishedAt > currentAt ? published.checkpointFeed : (base?.checkpointFeed || published?.checkpointFeed || null);
  if (!base) {
    return checkpoint.length ? { mock: false, advisories: checkpoint, checkpointFeed } : null;
  }
  return {
    ...base,
    advisories: [...cisco, ...checkpoint],
    checkpointFeed: checkpointFeed ? { ...checkpointFeed, shownCount: checkpoint.length } : null
  };
}

async function readSnapshot() {
  try {
    const response = await fetch(`data/status.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body || body.mock === true || !Array.isArray(body.events) || !body.providers) return null;
    return body;
  } catch {
    return null;
  }
}

function withNewerPublishedProvider(current, published, providerId) {
  const base = current && current.mock !== true ? current : null;
  if (!published?.providers?.[providerId]) return base;
  if (!base) return published;
  const currentAt = Date.parse(base.providers?.[providerId]?.lastSuccess || 0);
  const publishedAt = Date.parse(published.providers[providerId].lastSuccess || 0);
  if (!(publishedAt > currentAt)) return base;
  const events = (base.events || []).filter((event) => event.sourceProvider !== providerId);
  events.push(...(published.events || []).filter((event) => event.sourceProvider === providerId));
  return {
    ...base,
    providers: { ...base.providers, [providerId]: published.providers[providerId] },
    events
  };
}

function setMode(mode) {
  state.mode = mode;
  sessionStorage.setItem('status-feed-mode', mode);
  load();
}

els.reload.addEventListener('click', () => {
  if (state.mode === 'mock') load();
  else refreshFromProviders();
});
window.setInterval(() => refreshFromProviders(), 5 * 60 * 1000);
els.liveButton.addEventListener('click', () => setMode('live'));
els.mockButton.addEventListener('click', () => setMode('mock'));

const params = new URLSearchParams(window.location.search);
const stored = sessionStorage.getItem('status-feed-mode');
state.mode = params.get('preview') === 'mock' || stored === 'mock' ? 'mock' : 'live';
load();
