#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideInclusion } from './filter.js';
import { createHttp } from './lib/http.js';
import { publicError, stableStringify } from './lib/text.js';
import { buildMockDocument } from './mock-data.js';
import { PROVIDERS } from './providers/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'config', 'providers.json');
const statusPath = path.join(root, 'data', 'status.json');
const mockPath = path.join(root, 'data', 'mock-status.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function reasonCounts(events) {
  const counts = {};
  for (const event of events) {
    const reason = event.inclusionReason || 'No reason recorded';
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function materialView(document) {
  return {
    events: document.events,
    providers: Object.fromEntries(Object.entries(document.providers).map(([id, meta]) => [id, {
      sourceLabel: meta.sourceLabel,
      stale: meta.stale,
      error: meta.error,
      hasCache: meta.hasCache,
      rawCount: meta.rawCount,
      includedCount: meta.includedCount,
      excludedCount: meta.excludedCount,
      exclusionReasons: meta.exclusionReasons,
      warnings: meta.warnings
    }]))
  };
}

function writeJson(file, document) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
}

async function collect(config) {
  const now = new Date();
  const http = createHttp();
  const previous = readJson(statusPath);
  const usablePrevious = previous && previous.mock !== true ? previous : null;
  const settings = {
    now,
    recentlyResolvedHours: config.recentlyResolvedHours,
    maintenanceLookAheadDays: config.maintenanceLookAheadDays
  };
  const providers = {};
  const events = [];

  for (const provider of PROVIDERS) {
    const providerConfig = config.providers?.[provider.id];
    if (!providerConfig?.enabled) {
      console.log(`[${provider.id}] skipped because it is disabled`);
      continue;
    }
    try {
      const result = await provider.run({
        http,
        providerConfig,
        env: process.env,
        log: (line) => console.log(line),
        now
      });
      const decided = result.events.map((event) => decideInclusion(event, providerConfig, settings));
      const included = decided.filter((event) => event.included);
      const excluded = decided.filter((event) => !event.included);
      const exclusionReasons = reasonCounts(excluded);
      providers[provider.id] = {
        id: provider.id,
        name: provider.name,
        sourceLabel: result.sourceLabel,
        statusPageUrl: providerConfig.statusPageUrl || '',
        lastSuccess: now.toISOString(),
        stale: false,
        error: null,
        hasCache: true,
        rawCount: result.events.length,
        includedCount: included.length,
        excludedCount: excluded.length,
        exclusionReasons,
        warnings: result.warnings || []
      };
      events.push(...decided);
      console.log(`[${provider.id}] retrieved`);
      console.log(`[${provider.id}] raw=${result.events.length} included=${included.length} excluded=${excluded.length}`);
      for (const [reason, count] of Object.entries(exclusionReasons)) {
        console.log(`[${provider.id}] excluded ${count}: ${reason}`);
      }
    } catch (error) {
      const message = publicError(error);
      console.error(`[${provider.id}] retrieval failed: ${message}`);
      const cachedEvents = usablePrevious?.events?.filter((event) => event.sourceProvider === provider.id) || [];
      const previousMeta = usablePrevious?.providers?.[provider.id];
      const hasCache = Boolean(previousMeta?.hasCache) || cachedEvents.length > 0;
      providers[provider.id] = {
        id: provider.id,
        name: provider.name,
        sourceLabel: previousMeta?.sourceLabel || 'Unavailable',
        statusPageUrl: providerConfig.statusPageUrl || '',
        lastSuccess: previousMeta?.lastSuccess || null,
        stale: true,
        error: message,
        hasCache,
        rawCount: previousMeta?.rawCount || cachedEvents.length,
        includedCount: cachedEvents.filter((event) => event.included).length,
        excludedCount: cachedEvents.filter((event) => !event.included).length,
        exclusionReasons: previousMeta?.exclusionReasons || reasonCounts(cachedEvents.filter((event) => !event.included)),
        warnings: previousMeta?.warnings || []
      };
      events.push(...cachedEvents);
    }
  }

  events.sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    mock: false,
    mockNotice: null,
    organisation: config.organisation,
    dashboardTitle: config.dashboardTitle,
    timeZone: config.timeZone,
    generatedAt: now.toISOString(),
    refreshMinutes: config.refreshMinutes,
    maintenanceLookAheadDays: config.maintenanceLookAheadDays,
    recentlyResolvedHours: config.recentlyResolvedHours,
    providers,
    events
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const config = readJson(configPath);
  if (!config?.providers) {
    console.error('config/providers.json could not be read');
    process.exit(1);
  }
  if (args.has('--mock')) {
    writeJson(mockPath, buildMockDocument(config, new Date()));
    console.log(`Wrote fictional mock data to ${path.relative(root, mockPath)}`);
    return;
  }
  if (config.mockData === true) {
    console.error('config.mockData is true. Refusing to publish fictional events to data/status.json.');
    process.exit(1);
  }
  const next = await collect(config);
  const previous = readJson(statusPath);
  const unchanged = previous && stableStringify(materialView(previous)) === stableStringify(materialView(next));
  if (unchanged && !args.has('--publish')) {
    console.log('No material change. data/status.json was left unchanged.');
    return;
  }
  writeJson(statusPath, next);
  console.log(unchanged
    ? `Published a fresh collection time to ${path.relative(root, statusPath)}.`
    : `Wrote ${path.relative(root, statusPath)}`);
}

main().catch((error) => {
  console.error(publicError(error));
  process.exit(1);
});
