import {
  formatAge,
  formatDuration,
  formatLondon,
  formatRemaining,
  isCurrentIncident,
  isVisibleMaintenance,
  overallStatus,
  providerStatus,
  sortIncidents,
  sortMaintenance,
  statusLabel
} from './status-model.js';

const ORDER = ['azure', 'gcp', 'aws', 'ciscoUmbrella', 'cloudflare', 'syntura', 'example-empty'];
const LETTERS = {
  azure: 'Az',
  gcp: 'G',
  aws: 'Aw',
  ciscoUmbrella: 'Um',
  cloudflare: 'Cf',
  syntura: 'Sy',
  'example-empty': 'Ex'
};

const state = { mode: 'live', status: null };

const els = {
  title: document.querySelector('#dashboard-title'),
  overall: document.querySelector('#overall'),
  updated: document.querySelector('#updated'),
  schedule: document.querySelector('#schedule'),
  banners: document.querySelector('#banners'),
  cards: document.querySelector('#provider-cards'),
  incidents: document.querySelector('#incidents'),
  maintenance: document.querySelector('#maintenance'),
  resolved: document.querySelector('#resolved'),
  filter: document.querySelector('#filter-log'),
  live: document.querySelector('#live'),
  reload: document.querySelector('#reload'),
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
  if (meta.stale && meta.hasCache) {
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
  els.updated.textContent = `Last material update: ${formatLondon(status.generatedAt, zone)}`;
  const minutes = status.refreshMinutes || 5;
  els.schedule.textContent = `Collection schedule: every ${minutes} minutes. Unchanged data is not republished. GitHub may delay a scheduled run.`;
  clear(els.banners);
  if (status.mock) {
    els.banners.append(h('p', { class: 'banner banner-mock', role: 'status', text: status.mockNotice || 'Mock data. These events are fictional.' }));
  }
  const stale = providers.filter((meta) => meta.stale || !meta.hasCache);
  if (stale.length) {
    els.banners.append(h('p', {
      class: 'banner banner-stale',
      role: 'status',
      text: `Some provider feeds are stale or unavailable: ${stale.map((meta) => meta.name).join(', ')}.`
    }));
  }
  clear(els.cards);
  for (const meta of providers) els.cards.append(providerCard(meta, events, zone));
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
  els.reload.disabled = true;
  const file = state.mode === 'mock' ? 'data/mock-status.json' : 'data/status.json';
  try {
    const response = await fetch(`${file}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Status file returned HTTP ${response.status}`);
    const status = await response.json();
    if (!status || !Array.isArray(status.events) || !status.providers) throw new Error('Status file has an unexpected shape');
    state.status = status;
    render(status);
    const overall = els.overall.querySelector('.chip')?.textContent || 'Unknown';
    els.live.textContent = `${state.mode === 'mock' ? 'Mock scenarios' : 'Live feed'} loaded. Overall status is ${overall}.`;
  } catch (error) {
    clear(els.banners);
    els.banners.append(h('p', { class: 'banner banner-error', role: 'alert', text: 'The status file could not be read. Provider state is unknown.' }));
    els.live.textContent = 'The status file could not be read.';
    console.error(error?.message || 'status load failed');
  } finally {
    els.reload.disabled = false;
    els.liveButton.setAttribute('aria-pressed', state.mode === 'live' ? 'true' : 'false');
    els.mockButton.setAttribute('aria-pressed', state.mode === 'mock' ? 'true' : 'false');
  }
}

function setMode(mode) {
  state.mode = mode;
  sessionStorage.setItem('status-feed-mode', mode);
  load();
}

els.reload.addEventListener('click', load);
els.liveButton.addEventListener('click', () => setMode('live'));
els.mockButton.addEventListener('click', () => setMode('mock'));

const params = new URLSearchParams(window.location.search);
const stored = sessionStorage.getItem('status-feed-mode');
state.mode = params.get('preview') === 'mock' || stored === 'mock' ? 'mock' : 'live';
load();
