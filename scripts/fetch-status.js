#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectStatus } from './collect.js';
import { publicError, stableStringify } from './lib/text.js';
import { buildMockDocument } from './mock-data.js';

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
    }])),
    advisories: (document.advisories || []).map((item) => ({
      id: item.id,
      title: item.title,
      cves: item.cves,
      severity: item.severity,
      publishedAt: item.publishedAt
    })),
    advisoryFeed: document.advisoryFeed ? {
      stale: document.advisoryFeed.stale,
      error: document.advisoryFeed.error,
      shownCount: document.advisoryFeed.shownCount
    } : null
  };
}

function writeJson(file, document) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
}

async function collect(config) {
  const previous = readJson(statusPath);
  return collectStatus({
    config,
    previous: previous && previous.mock !== true ? previous : null,
    env: process.env,
    log: (line) => console.log(line)
  });
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
