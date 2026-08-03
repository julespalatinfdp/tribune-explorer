import { ChannelType } from 'discord.js';
import { config } from './config.js';
import { CSV_HEADERS, messageToRow } from './mapper.js';
import { toCsv } from './csv.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Convertit une date (JS Date) en snowflake Discord approximatif,
 * utilisable dans les paramètres before/after de l'API.
 */
export function dateToSnowflake(date) {
  const DISCORD_EPOCH = 1420070400000n;
  const ms = BigInt(new Date(date).getTime());
  return ((ms - DISCORD_EPOCH) << 22n).toString();
}

/**
 * Résout le canal cible : par ID si fourni, sinon par nom.
 */
export async function resolveChannel(guild, { channelId, channelName } = {}) {
  const id = channelId ?? config.channelId;
  if (id) {
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (!channel) throw new Error(`Canal introuvable pour l'ID ${id}.`);
    return channel;
  }

  const wanted = (channelName ?? config.channelName).toLowerCase().replace(/[\s_-]/g, '');
  const channels = await guild.channels.fetch();
  const match = channels.find(
    (c) =>
      c &&
      [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type) &&
      c.name.toLowerCase().replace(/[\s_-]/g, '') === wanted
  );
  if (!match) {
    throw new Error(
      `Aucun canal texte nommé "${channelName ?? config.channelName}" trouvé. Renseigne TRIBUNE_CHANNEL_ID.`
    );
  }
  return match;
}

/**
 * Récupère tous les messages d'un canal (ou d'un fil), du plus ancien au plus récent.
 * Pagination par lots de 100 via le paramètre `before`.
 */
export async function fetchAllMessages(channel, options = {}) {
  const { afterDate = null, beforeDate = null, onProgress = null } = options;
  const delayMs = options.delayMs ?? config.fetchDelayMs;

  const stopAtTimestamp = afterDate ? new Date(afterDate).getTime() : null;
  let before = beforeDate ? dateToSnowflake(beforeDate) : undefined;

  const collected = [];
  let reachedEnd = false;

  while (!reachedEnd) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;

    for (const msg of batch.values()) {
      if (stopAtTimestamp && msg.createdTimestamp < stopAtTimestamp) {
        reachedEnd = true;
        continue;
      }
      collected.push(msg);
    }

    before = batch.last().id;
    if (batch.size < 100) reachedEnd = true;

    if (onProgress) await onProgress(collected.length);
    if (!reachedEnd && delayMs > 0) await sleep(delayMs);
  }

  return collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

/**
 * Liste les fils actifs + archivés (publics et privés) rattachés au canal.
 */
export async function listThreads(channel) {
  const threads = new Map();

  const push = (collection) => {
    for (const t of collection.values()) threads.set(t.id, t);
  };

  try {
    const active = await channel.threads.fetchActive();
    push(active.threads);
  } catch (err) {
    console.warn('[threads] fils actifs indisponibles :', err.message);
  }

  try {
    const archived = await channel.threads.fetchArchived({ type: 'public', limit: 100 });
    push(archived.threads);
  } catch (err) {
    console.warn('[threads] fils publics archivés indisponibles :', err.message);
  }

  try {
    const archivedPrivate = await channel.threads.fetchArchived({ type: 'private', limit: 100 });
    push(archivedPrivate.threads);
  } catch (err) {
    console.warn('[threads] fils privés archivés indisponibles :', err.message);
  }

  return [...threads.values()];
}

/**
 * Export complet : canal principal (+ fils optionnels) -> lignes CSV.
 */
export async function exportChannel(channel, options = {}) {
  const includeThreads = options.includeThreads ?? config.includeThreads;
  const onProgress = options.onProgress ?? null;
  const startedAt = Date.now();

  const rows = [];
  const stats = { mainMessages: 0, threadMessages: 0, threads: 0, authors: new Set() };

  const mainMessages = await fetchAllMessages(channel, {
    afterDate: options.afterDate,
    beforeDate: options.beforeDate,
    onProgress: onProgress
      ? (count) => onProgress(`Canal #${channel.name} : ${count} messages récupérés…`)
      : null,
  });

  for (const msg of mainMessages) {
    rows.push(messageToRow(msg, { channelName: channel.name, anonymize: options.anonymize }));
    stats.authors.add(msg.author?.id);
  }
  stats.mainMessages = mainMessages.length;

  if (includeThreads) {
    const threads = await listThreads(channel);
    stats.threads = threads.length;

    for (const [index, thread] of threads.entries()) {
      if (onProgress) {
        await onProgress(`Fil ${index + 1}/${threads.length} : « ${thread.name} »…`);
      }
      const threadMessages = await fetchAllMessages(thread, {
        afterDate: options.afterDate,
        beforeDate: options.beforeDate,
      });
      for (const msg of threadMessages) {
        rows.push(
          messageToRow(msg, {
            channelName: channel.name,
            threadId: thread.id,
            threadName: thread.name,
            anonymize: options.anonymize,
          })
        );
        stats.authors.add(msg.author?.id);
      }
      stats.threadMessages += threadMessages.length;
    }
  }

  rows.sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc));

  const csv = toCsv(rows, CSV_HEADERS);

  const byMonth = {};
  for (const row of rows) {
    const key = row.mois;
    byMonth[key] = (byMonth[key] ?? 0) + 1;
  }

  return {
    csv,
    rows,
    stats: {
      ...stats,
      byMonth,
      authors: stats.authors.size,
      total: rows.length,
      durationSec: Math.round((Date.now() - startedAt) / 1000),
      firstMessage: rows[0]?.date_paris ?? null,
      lastMessage: rows.at(-1)?.date_paris ?? null,
    },
  };
}
