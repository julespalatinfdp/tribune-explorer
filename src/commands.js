import { AttachmentBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from './config.js';
import { exportChannel, resolveChannel } from './exporter.js';
import { groupByMonth, resolvePeriod } from './period.js';
import { CSV_HEADERS } from './mapper.js';
import { toCsv } from './csv.js';
import { buildFileName, saveCsv } from './storage.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('export-tribune')
    .setDescription('Exporte les messages du canal La Tribune au format CSV')
    .addStringOption((opt) =>
      opt
        .setName('depuis')
        .setDescription('Début de période — AAAA-MM (mois entier) ou AAAA-MM-JJ. Ex : 2026-06')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('jusqua')
        .setDescription('Fin de période incluse — AAAA-MM ou AAAA-MM-JJ. Ex : 2026-07')
        .setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt
        .setName('un-fichier-par-mois')
        .setDescription('Générer un CSV distinct par mois plutôt qu\'un fichier unique')
        .setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt
        .setName('fils')
        .setDescription('Inclure les messages des fils de discussion (défaut : oui)')
        .setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt
        .setName('pseudonymiser')
        .setDescription('Remplacer les identités par un hash (RGPD)')
        .setRequired(false)
    )
    .addChannelOption((opt) =>
      opt
        .setName('canal')
        .setDescription('Forcer un autre canal que celui configuré')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('export-status')
    .setDescription('Affiche la configuration active du bot d\'export')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .toJSON(),
];

function isAuthorized(interaction) {
  const { authorizedUserIds, authorizedRoleIds } = config;

  // Si aucune liste blanche n'est definie, on retombe sur la permission "Gerer le serveur"
  if (authorizedUserIds.length === 0 && authorizedRoleIds.length === 0) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  }

  if (authorizedUserIds.includes(interaction.user.id)) return true;
  const memberRoles = interaction.member?.roles?.cache;
  if (memberRoles && authorizedRoleIds.some((roleId) => memberRoles.has(roleId))) return true;
  return false;
}

export async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'export-status') {
    await interaction.reply({
      ephemeral: true,
      content: [
        '**Configuration active**',
        `• Canal cible : ${config.channelId ? `<#${config.channelId}>` : `#${config.channelName}`}`,
        `• Fils inclus par défaut : ${config.includeThreads ? 'oui' : 'non'}`,
        `• Séparateur CSV : \`${config.csvDelimiter}\` (BOM UTF-8 : ${config.csvBom ? 'oui' : 'non'})`,
        `• Pseudonymisation par défaut : ${config.anonymize ? 'oui' : 'non'}`,
        `• Téléchargement HTTP : ${config.exportToken && config.publicUrl ? 'activé' : 'désactivé'}`,
        '',
        'Exemple période : `/export-tribune depuis:2026-06 jusqua:2026-07`',
      ].join('\n'),
    });
    return;
  }

  if (interaction.commandName !== 'export-tribune') return;

  if (!isAuthorized(interaction)) {
    await interaction.reply({
      ephemeral: true,
      content: "Tu n'as pas l'autorisation de lancer un export sur ce serveur.",
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const includeThreads = interaction.options.getBoolean('fils') ?? config.includeThreads;
    const anonymize = interaction.options.getBoolean('pseudonymiser') ?? config.anonymize;
    const splitByMonth = interaction.options.getBoolean('un-fichier-par-mois') ?? false;
    const overrideChannel = interaction.options.getChannel('canal');

    const period = resolvePeriod({
      depuis: interaction.options.getString('depuis'),
      jusqua: interaction.options.getString('jusqua'),
    });

    const channel = overrideChannel
      ? await interaction.guild.channels.fetch(overrideChannel.id)
      : await resolveChannel(interaction.guild);

    if (!channel?.isTextBased?.()) {
      throw new Error("Le canal sélectionné n'est pas un canal textuel.");
    }

    const me = await interaction.guild.members.fetchMe();
    const perms = channel.permissionsFor(me);
    if (
      !perms?.has(PermissionFlagsBits.ViewChannel) ||
      !perms?.has(PermissionFlagsBits.ReadMessageHistory)
    ) {
      throw new Error(
        `Le bot n'a pas les permissions « Voir le salon » et « Voir les messages précédents » sur ${channel}.`
      );
    }

    await interaction.editReply(
      `Export de ${channel} — ${period.label} — en cours…\n(le bot remonte l'historique par lots de 100 messages)`
    );

    let lastEdit = 0;
    const onProgress = async (message) => {
      const now = Date.now();
      if (now - lastEdit < 4000) return; // evite de saturer l'API
      lastEdit = now;
      await interaction.editReply(`Export en cours — ${period.label}\n${message}`).catch(() => {});
    };

    const { csv, rows, stats } = await exportChannel(channel, {
      includeThreads,
      anonymize,
      afterDate: period.afterDate,
      beforeDate: period.beforeDate,
      onProgress,
    });

    if (stats.total === 0) {
      await interaction.editReply(
        `Aucun message trouvé sur #${channel.name} pour la période ${period.label}.`
      );
      return;
    }

    const monthlyBreakdown = Object.entries(stats.byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => `   ↳ ${month} : ${count} messages`)
      .join('\n');

    const summary = [
      `**Export terminé — #${channel.name}**`,
      `• Période : ${period.label} (Europe/Paris)`,
      `• Messages : **${stats.total}** (canal : ${stats.mainMessages}, fils : ${stats.threadMessages})`,
      monthlyBreakdown,
      `• Fils parcourus : ${stats.threads}`,
      `• Auteurs uniques : ${stats.authors}`,
      `• Premier / dernier : ${stats.firstMessage ?? '—'} → ${stats.lastMessage ?? '—'}`,
      `• Durée : ${stats.durationSec}s`,
      anonymize ? '• Pseudonymisation : activée' : null,
    ]
      .filter(Boolean)
      .join('\n');

    // Construction des fichiers : un seul CSV, ou un par mois
    const files = [];
    if (splitByMonth) {
      for (const [month, monthRows] of groupByMonth(rows)) {
        files.push({
          name: buildFileName(channel.name, { prefix: 'betclic-tribune', suffix: month }),
          content: toCsv(monthRows, CSV_HEADERS),
        });
      }
    } else {
      files.push({
        name: buildFileName(channel.name, { prefix: 'betclic-tribune', suffix: period.slug }),
        content: csv,
      });
    }

    let totalSize = 0;
    for (const file of files) {
      const { size } = await saveCsv(file.name, file.content);
      file.size = size;
      totalSize += size;
    }

    const sizeLine = `• Fichier(s) : ${files.length} — ${(totalSize / 1024 / 1024).toFixed(2)} Mo au total`;
    const fullSummary = `${summary}\n${sizeLine}`;

    const oversized = files.filter((f) => f.size > config.maxAttachmentBytes);

    if (oversized.length === 0 && files.length <= 10) {
      const attachments = files.map(
        (f) => new AttachmentBuilder(Buffer.from(f.content, 'utf8'), { name: f.name })
      );
      await interaction.editReply({ content: fullSummary, files: attachments });
      return;
    }

    if (config.publicUrl && config.exportToken) {
      const links = files
        .map((f) => {
          const url = `${config.publicUrl}/download/${encodeURIComponent(f.name)}?token=${encodeURIComponent(config.exportToken)}`;
          return `• [${f.name}](${url}) — ${(f.size / 1024 / 1024).toFixed(2)} Mo`;
        })
        .join('\n');
      await interaction.editReply(
        `${fullSummary}\n\nFichier(s) trop volumineux pour Discord. Liens privés, valables ${config.retentionHours}h :\n${links}`
      );
      return;
    }

    await interaction.editReply(
      `${fullSummary}\n\nFichier trop volumineux pour Discord et aucun lien de téléchargement configuré. Définis \`EXPORT_TOKEN\`, ou relance avec \`un-fichier-par-mois:true\` pour réduire la taille de chaque fichier.`
    );
  } catch (error) {
    console.error('[export] erreur :', error);
    await interaction
      .editReply(`Échec de l'export : ${error.message ?? 'erreur inconnue'}`)
      .catch(() => {});
  }
}
