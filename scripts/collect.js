import { CHECKPOINT_ADVISORY_FEED, CHECKPOINT_ADVISORY_PAGE, retainCheckpointAdvisories, retrieveCheckpointAdvisories } from './advisories/checkpoint.js';
import { CISCO_ADVISORY_FEED, CISCO_ADVISORY_PAGE, retainCiscoAdvisories, retrieveCiscoAdvisories } from './advisories/cisco-psirt.js';
import { decideInclusion } from './filter.js';
import { createHttp } from './lib/http.js';
import { publicError } from './lib/text.js';
import { PROVIDERS } from './providers/index.js';

function reasonCounts(events) {
  const counts = {};
  for (const event of events) {
    const reason = event.inclusionReason || 'No reason recorded';
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function advisoriesBySource(advisories) {
  const cisco = [];
  const checkpoint = [];
  for (const item of advisories || []) {
    if (item?.source === 'checkpoint') checkpoint.push(item);
    else if (item) cisco.push(item);
  }
  return { cisco, checkpoint };
}

function checkpointFeedFrom(config, advisories, previousFeed, now, { stale, error, rawCount }) {
  const checkpointConfig = config.advisories?.checkpoint || {};
  const retentionDays = Number(checkpointConfig.retentionDays) > 0 ? Number(checkpointConfig.retentionDays) : 30;
  return {
    sourceLabel: previousFeed?.sourceLabel || 'Check Point advisories',
    feedUrl: checkpointConfig.feedUrl || CHECKPOINT_ADVISORY_FEED,
    statusPageUrl: checkpointConfig.statusPageUrl || CHECKPOINT_ADVISORY_PAGE,
    lastSuccess: stale ? (previousFeed?.lastSuccess || null) : now.toISOString(),
    stale,
    error,
    hasCache: advisories.length > 0,
    rawCount: rawCount ?? previousFeed?.rawCount ?? 0,
    shownCount: advisories.length,
    retentionDays
  };
}

export async function collectStatus({
  config,
  previous = null,
  env = {},
  log = () => {},
  now = new Date(),
  http = createHttp(),
  readCheckpoint
} = {}) {
  const usablePrevious = previous && previous.mock !== true ? previous : null;
  const settings = {
    now,
    recentlyResolvedHours: config.recentlyResolvedHours,
    maintenanceLookAheadDays: config.maintenanceLookAheadDays
  };
  const enabled = PROVIDERS.filter((provider) => config.providers?.[provider.id]?.enabled);
  const stored = advisoriesBySource(usablePrevious?.advisories);
  const advisoryConfig = config.advisories?.cisco || { enabled: true };
  const retentionDays = Number(advisoryConfig.retentionDays) > 0 ? Number(advisoryConfig.retentionDays) : 7;
  const keepAdvisories = (incoming) => retainCiscoAdvisories(incoming, stored.cisco, { now, retentionDays });
  const advisoryTask = advisoryConfig.enabled === false
    ? Promise.resolve(null)
    : retrieveCiscoAdvisories({
      http,
      feedUrl: advisoryConfig.feedUrl || CISCO_ADVISORY_FEED
    }).then((result) => {
      const advisories = keepAdvisories(result.advisories);
      return {
        advisories,
        feed: {
          sourceLabel: result.sourceLabel,
          feedUrl: advisoryConfig.feedUrl || CISCO_ADVISORY_FEED,
          statusPageUrl: advisoryConfig.statusPageUrl || CISCO_ADVISORY_PAGE,
          lastSuccess: now.toISOString(),
          stale: false,
          error: null,
          hasCache: true,
          rawCount: result.rawCount,
          shownCount: advisories.length,
          retentionDays
        }
      };
    }).catch((error) => {
      const message = publicError(error);
      log(`[cisco-advisories] retrieval failed: ${message}`);
      const advisories = keepAdvisories([]);
      const previousFeed = usablePrevious?.advisoryFeed;
      return {
        advisories,
        feed: {
          sourceLabel: previousFeed?.sourceLabel || 'Cisco PSIRT',
          feedUrl: advisoryConfig.feedUrl || CISCO_ADVISORY_FEED,
          statusPageUrl: advisoryConfig.statusPageUrl || CISCO_ADVISORY_PAGE,
          lastSuccess: previousFeed?.lastSuccess || null,
          stale: true,
          error: message,
          hasCache: advisories.length > 0,
          rawCount: previousFeed?.rawCount || 0,
          shownCount: advisories.length,
          retentionDays
        }
      };
    });
  const checkpointConfig = config.advisories?.checkpoint || { enabled: true };
  const checkpointDays = Number(checkpointConfig.retentionDays) > 0 ? Number(checkpointConfig.retentionDays) : 30;
  const keepCheckpoint = (incoming) => retainCheckpointAdvisories(incoming, stored.checkpoint, { now, retentionDays: checkpointDays });
  const readCheckpointHere = (readCheckpoint ?? typeof window === 'undefined') && checkpointConfig.enabled !== false;
  const checkpointTask = checkpointConfig.enabled === false
    ? Promise.resolve({ advisories: [], feed: null })
    : !readCheckpointHere
      ? Promise.resolve().then(() => {
        const advisories = keepCheckpoint([]);
        const previousFeed = usablePrevious?.checkpointFeed || null;
        return {
          advisories,
          feed: previousFeed ? {
            ...previousFeed,
            shownCount: advisories.length,
            hasCache: advisories.length > 0 || previousFeed.hasCache === true
          } : null
        };
      })
      : retrieveCheckpointAdvisories({
        http,
        feedUrl: checkpointConfig.feedUrl || CHECKPOINT_ADVISORY_FEED
      }).then((result) => {
        const advisories = keepCheckpoint(result.advisories);
        return {
          advisories,
          feed: checkpointFeedFrom(config, advisories, null, now, {
            stale: false,
            error: null,
            rawCount: result.rawCount
          })
        };
      }).catch((error) => {
        const message = publicError(error);
        log(`[checkpoint-advisories] retrieval failed: ${message}`);
        const advisories = keepCheckpoint([]);
        return {
          advisories,
          feed: checkpointFeedFrom(config, advisories, usablePrevious?.checkpointFeed, now, {
            stale: true,
            error: message,
            rawCount: usablePrevious?.checkpointFeed?.rawCount || 0
          })
        };
      });
  const settled = await Promise.all(enabled.map(async (provider) => {
    const providerConfig = config.providers[provider.id];
    try {
      const result = await provider.run({ http, providerConfig, env, log, now });
      const decided = result.events.map((event) => decideInclusion(event, providerConfig, settings));
      const included = decided.filter((event) => event.included);
      const excluded = decided.filter((event) => !event.included);
      const exclusionReasons = reasonCounts(excluded);
      log(`[${provider.id}] retrieved`);
      log(`[${provider.id}] raw=${result.events.length} included=${included.length} excluded=${excluded.length}`);
      for (const [reason, count] of Object.entries(exclusionReasons)) {
        log(`[${provider.id}] excluded ${count}: ${reason}`);
      }
      return {
        id: provider.id,
        events: decided,
        meta: {
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
        }
      };
    } catch (error) {
      const message = publicError(error);
      log(`[${provider.id}] retrieval failed: ${message}`);
      const cachedEvents = usablePrevious?.events?.filter((event) => event.sourceProvider === provider.id) || [];
      const previousMeta = usablePrevious?.providers?.[provider.id];
      const hasCache = Boolean(previousMeta?.hasCache) || cachedEvents.length > 0;
      return {
        id: provider.id,
        events: cachedEvents,
        meta: {
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
        }
      };
    }
  }));

  const providers = {};
  const events = [];
  for (const item of settled) {
    providers[item.id] = item.meta;
    events.push(...item.events);
  }
  events.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const [advisoryResult, checkpointResult] = await Promise.all([advisoryTask, checkpointTask]);
  const advisories = [...(advisoryResult?.advisories || []), ...(checkpointResult?.advisories || [])]
    .sort((left, right) => String(right.publishedAt || '').localeCompare(String(left.publishedAt || '')));
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
    events,
    advisories,
    advisoryFeed: advisoryResult?.feed || null,
    checkpointFeed: checkpointResult?.feed || null
  };
}
