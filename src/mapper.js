import { createHash } from 'node:crypto';
import { config } from './config.js';

export const CSV_HEADERS = [
  'message_id',
  'channel_id',
  'channel_name',
  'thread_id',
  'thread_name',
  'mois',
  'date_paris',
  'timestamp_utc',
  'edited_utc',
  'author_id',
  'author_username',
  'author_display_name',
  'author_is_bot',
  'content',
  'content_length',
  'reply_to_message_id',
  'attachments_count',
  'attachments_names',
  'attachments_urls',
  'embeds_count',
  'embed_titles',
  'stickers',
  'reactions',
  'reactions_total',
  'mentions_users',
  'mentions_roles',
  'mentions_everyone',
  'is_pinned',
  'message_type',
  'jump_url',
];

const parisFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatParis(timestamp) {
  if (!timestamp) return '';
  // Rend "2026-08-03 14:22:11" en heure de Paris
  return parisFormatter.format(new Date(timestamp)).replace(',', '');
}

function pseudonymize(value) {
  if (!value) return '';
  return createHash('sha256').update(`${config.anonymizeSalt}:${value}`).digest('hex').slice(0, 16);
}

/**
 * Transforme un message discord.js en objet plat prêt pour le CSV.
 */
export function messageToRow(msg, context = {}) {
  const { channelName = '', threadId = '', threadName = '' } = context;
  const anonymize = context.anonymize ?? config.anonymize;

  const attachments = [...msg.attachments.values()];
  const embeds = msg.embeds ?? [];
  const reactions = [...msg.reactions.cache.values()];
  const stickers = [...(msg.stickers?.values() ?? [])];

  const authorId = msg.author?.id ?? '';
  const authorUsername = msg.author?.username ?? '';
  const authorDisplay = msg.member?.displayName ?? msg.author?.globalName ?? authorUsername;

  return {
    message_id: msg.id,
    channel_id: msg.channelId,
    channel_name: channelName,
    thread_id: threadId,
    thread_name: threadName,
    mois: formatParis(msg.createdTimestamp).slice(0, 7),
    date_paris: formatParis(msg.createdTimestamp),
    timestamp_utc: new Date(msg.createdTimestamp).toISOString(),
    edited_utc: msg.editedTimestamp ? new Date(msg.editedTimestamp).toISOString() : '',
    author_id: anonymize ? pseudonymize(authorId) : authorId,
    author_username: anonymize ? pseudonymize(authorUsername) : authorUsername,
    author_display_name: anonymize ? pseudonymize(authorDisplay) : authorDisplay,
    author_is_bot: msg.author?.bot ? 'true' : 'false',
    content: anonymize ? scrubMentions(msg.content ?? '') : msg.content ?? '',
    content_length: (msg.content ?? '').length,
    reply_to_message_id: msg.reference?.messageId ?? '',
    attachments_count: attachments.length,
    attachments_names: attachments.map((a) => a.name).join(' | '),
    attachments_urls: anonymize ? '' : attachments.map((a) => a.url).join(' | '),
    embeds_count: embeds.length,
    embed_titles: embeds.map((e) => e.title || e.author?.name || '').filter(Boolean).join(' | '),
    stickers: stickers.map((s) => s.name).join(' | '),
    reactions: reactions.map((r) => `${r.emoji.name}:${r.count}`).join(' | '),
    reactions_total: reactions.reduce((acc, r) => acc + r.count, 0),
    mentions_users: anonymize
      ? msg.mentions.users.size
      : [...msg.mentions.users.values()].map((u) => u.username).join(' | '),
    mentions_roles: [...msg.mentions.roles.values()].map((r) => r.name).join(' | '),
    mentions_everyone: msg.mentions.everyone ? 'true' : 'false',
    is_pinned: msg.pinned ? 'true' : 'false',
    message_type: msg.type,
    jump_url: anonymize ? '' : msg.url,
  };
}

function scrubMentions(content) {
  return content.replace(/<@!?\d+>/g, '@utilisateur');
}
