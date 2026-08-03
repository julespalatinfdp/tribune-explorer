/**
 * Export en ligne de commande — utile pour les très gros canaux
 * ou pour un export ponctuel en local sans passer par Discord.
 *
 * Exemples :
 *   npm run export:cli -- --depuis=2026-06 --jusqua=2026-07
 *   npm run export:cli -- --depuis=2026-06 --jusqua=2026-07 --par-mois
 *   npm run export:cli -- --depuis=2026-06-15 --jusqua=2026-07-15 --sans-fils
 *   npm run export:cli -- --pseudonymiser
 *
 * Les bornes acceptent AAAA-MM (mois entier) ou AAAA-MM-JJ.
 * La borne de fin est inclusive.
 */
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { assertConfig, config } from '../src/config.js';
import { exportChannel, resolveChannel } from '../src/exporter.js';
import { groupByMonth, resolvePeriod } from '../src/period.js';
import { CSV_HEADERS } from '../src/mapper.js';
import { toCsv } from '../src/csv.js';
import { buildFileName, saveCsv } from '../src/storage.js';

assertConfig({ requireHttp: false });

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
  })
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async () => {
  try {
    const period = resolvePeriod({ depuis: args.depuis, jusqua: args.jusqua });
    const guild = await client.guilds.fetch(config.guildId);
    const channel = await resolveChannel(guild, { channelId: args.canal || undefined });

    console.log(`Export du canal #${channel.name} — ${period.label}`);

    const { csv, rows, stats } = await exportChannel(channel, {
      includeThreads: !args['sans-fils'],
      anonymize: Boolean(args.pseudonymiser),
      afterDate: period.afterDate,
      beforeDate: period.beforeDate,
      onProgress: (msg) => process.stdout.write(`\r${msg.padEnd(80)}`),
    });

    if (stats.total === 0) {
      console.log('\nAucun message sur cette période.');
      return;
    }

    const files = [];
    if (args['par-mois']) {
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

    console.log('\n──────────────────────────────────────');
    console.log(`Période          : ${period.label}`);
    console.log(`Messages         : ${stats.total}`);
    console.log(`  • canal        : ${stats.mainMessages}`);
    console.log(`  • fils (${stats.threads})    : ${stats.threadMessages}`);
    for (const [month, count] of Object.entries(stats.byMonth).sort()) {
      console.log(`  • ${month}      : ${count}`);
    }
    console.log(`Auteurs uniques  : ${stats.authors}`);
    console.log(`Premier/dernier  : ${stats.firstMessage} → ${stats.lastMessage}`);
    console.log(`Durée            : ${stats.durationSec}s`);
    console.log('──────────────────────────────────────');

    for (const file of files) {
      const { filePath, size } = await saveCsv(file.name, file.content);
      console.log(`✔ ${filePath} (${(size / 1024 / 1024).toFixed(2)} Mo)`);
    }
  } catch (error) {
    console.error('\n❌ Erreur :', error.message);
    process.exitCode = 1;
  } finally {
    await client.destroy();
  }
});

client.login(config.token);
