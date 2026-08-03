import 'dotenv/config';

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'oui', 'on'].includes(String(value).trim().toLowerCase());
}

function toList(value) {
  if (!value) return [];
  return String(value)
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export const config = {
  // --- Discord ---
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.GUILD_ID,

  // Canal cible : l'ID est prioritaire, le nom sert de repli
  channelId: process.env.TRIBUNE_CHANNEL_ID || null,
  channelName: process.env.TRIBUNE_CHANNEL_NAME || 'la-tribune',

  // --- Autorisations d'exécution de la commande ---
  authorizedUserIds: toList(process.env.AUTHORIZED_USER_IDS),
  authorizedRoleIds: toList(process.env.AUTHORIZED_ROLE_IDS),

  // --- Options d'export ---
  csvDelimiter: process.env.CSV_DELIMITER || ';', // ';' = ouverture directe dans Excel FR
  csvBom: toBool(process.env.CSV_BOM, true), // BOM UTF-8 pour les accents dans Excel
  flattenNewlines: toBool(process.env.CSV_FLATTEN_NEWLINES, true),
  sanitizeFormulas: toBool(process.env.CSV_SANITIZE_FORMULAS, true),
  includeThreads: toBool(process.env.INCLUDE_THREADS, true),
  fetchDelayMs: Number(process.env.FETCH_DELAY_MS || 300),

  // --- RGPD / pseudonymisation ---
  anonymize: toBool(process.env.ANONYMIZE, false),
  anonymizeSalt: process.env.ANONYMIZE_SALT || 'netcord-default-salt',

  // --- Serveur HTTP (téléchargement des gros exports) ---
  port: Number(process.env.PORT || 3000),
  exportToken: process.env.EXPORT_TOKEN || null,
  publicUrl:
    process.env.PUBLIC_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null),
  exportsDir: process.env.EXPORTS_DIR || 'exports',
  retentionHours: Number(process.env.EXPORT_RETENTION_HOURS || 24),

  // Limite d'upload Discord (8 Mo par défaut, on garde une marge)
  maxAttachmentBytes: Number(process.env.MAX_ATTACHMENT_BYTES || 7_500_000),
};

export function assertConfig({ requireHttp = true } = {}) {
  const missing = [];
  if (!config.token) missing.push('DISCORD_TOKEN');
  if (!config.guildId) missing.push('GUILD_ID');
  if (missing.length) {
    throw new Error(
      `Variables d'environnement manquantes : ${missing.join(', ')}. Copie .env.example vers .env et complète-le.`
    );
  }
  if (requireHttp && !config.exportToken) {
    console.warn(
      '[config] EXPORT_TOKEN non défini : le téléchargement HTTP des exports volumineux sera désactivé.'
    );
  }
}
