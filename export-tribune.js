// ─────────────────────────────────────────────────────────────
// EXPORT LA TRIBUNE : messages d'un canal Discord -> CSV
// Usage :
//   DISCORD_TOKEN=xxx CHANNEL_ID=xxx node export-tribune.js
// Variables optionnelles :
//   START_DATE=2026-06-01     (inclus)
//   END_DATE=2026-08-01       (exclu)
//   INCLUDE_THREADS=false     (par défaut : true)
//   ANONYMIZE=true            (pseudonymise les auteurs, recommandé RGPD)
//   OUT=./export-tribune.csv
// ─────────────────────────────────────────────────────────────
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException',  (err) => console.error('[uncaughtException]', err));

const TOKEN           = process.env.DISCORD_TOKEN;
const CHANNEL_ID      = process.env.CHANNEL_ID;
const START_DATE      = process.env.START_DATE || '2026-06-01';
const END_DATE        = process.env.END_DATE   || '2026-08-01'; // exclu
const INCLUDE_THREADS = process.env.INCLUDE_THREADS !== 'false';
const ANONYMIZE       = process.env.ANONYMIZE === 'true';
const OUT             = process.env.OUT || './export-tribune.csv';

if (!TOKEN || !CHANNEL_ID) {
  console.error('❌ Il faut DISCORD_TOKEN et CHANNEL_ID.');
  console.error('   Exemple : DISCORD_TOKEN=xxx CHANNEL_ID=123456789 node export-tribune.js');
  process.exit(1);
}

const startTs = new Date(`${START_DATE}T00:00:00+02:00`).getTime();
const endTs   = new Date(`${END_DATE}T00:00:00+02:00`).getTime();

if (isNaN(startTs) || isNaN(endTs) || endTs <= startTs) {
  console.error('❌ Dates invalides. Format attendu : YYYY-MM-DD');
  process.exit(1);
}

// Snowflake Discord = ((timestamp - epoch) << 22) : permet de démarrer la
// pagination directement à la date de fin, au lieu de remonter depuis aujourd'hui.
function dateToSnowflake(ts) {
  return ((BigInt(ts) - 1420070400000n) << 22n).toString();
}

// ── Pseudonymisation (identifiants stables : même membre = même code) ──
const anonMap = new Map();
function anonId(userId) {
  if (!anonMap.has(userId)) {
    anonMap.set(userId, 'Membre_' + String(anonMap.size + 1).padStart(4, '0'));
  }
  return anonMap.get(userId);
}

const esc = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';

function fmtParis(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }); // YYYY-MM-DD
  const time = d.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour12: false });
  return [date, time];
}

const HEADER = [
  'message_id', 'date', 'heure', 'salon', 'auteur', 'pseudo', 'user_id',
  'message', 'reponse_a_message_id', 'reactions', 'nb_reactions', 'nb_pieces_jointes',
];

const rows = [];

function writeCsv() {
  // Tri chronologique (on récupère du plus récent au plus ancien)
  const sorted = [...rows].sort((a, b) => a._ts - b._ts);
  const lines = sorted.map(r => [
    r.message_id, esc(r.date), esc(r.heure), esc(r.salon), esc(r.auteur), esc(r.pseudo),
    esc(r.user_id), esc(r.message), r.reponse_a || '', esc(r.reactions),
    r.nb_reactions, r.nb_pieces_jointes,
  ].join(','));
  // BOM UTF-8 pour qu'Excel affiche correctement les accents et emojis
  fs.writeFileSync(OUT, '\ufeff' + HEADER.join(',') + '\n' + lines.join('\n'));
}

function pushMessage(msg, salonLabel) {
  const [date, heure] = fmtParis(msg.createdTimestamp);

  const reacts = msg.reactions?.cache?.map(r => `${r.emoji.name}x${r.count}`) || [];
  const nbReacts = reacts.reduce((n, r) => n + parseInt(r.split('x').pop(), 10) || 0, 0);

  const displayName = msg.member?.displayName || msg.author.globalName || msg.author.username;

  rows.push({
    _ts: msg.createdTimestamp,
    message_id: msg.id,
    date, heure,
    salon: salonLabel,
    auteur: ANONYMIZE ? anonId(msg.author.id) : displayName,
    pseudo: ANONYMIZE ? anonId(msg.author.id) : msg.author.username,
    user_id: ANONYMIZE ? anonId(msg.author.id) : msg.author.id,
    message: msg.content || '',
    reponse_a: msg.reference?.messageId || '',
    reactions: reacts.join(' | '),
    nb_reactions: nbReacts,
    nb_pieces_jointes: msg.attachments?.size || 0,
  });
}

async function scanChannel(channel, salonLabel) {
  let before = dateToSnowflake(endTs);
  let kept = 0, scanned = 0;

  for (;;) {
    let batch;
    try {
      batch = await channel.messages.fetch({ limit: 100, before });
    } catch (e) {
      console.log(`   ⚠️  ${salonLabel} : lecture interrompue (${e.message})`);
      break;
    }
    if (batch.size === 0) break;

    let reachedStart = false;
    for (const msg of batch.values()) {
      scanned++;
      if (msg.createdTimestamp < startTs) { reachedStart = true; continue; }
      if (msg.createdTimestamp >= endTs) continue;
      if (msg.author.bot) continue; // retire les messages de bots
      pushMessage(msg, salonLabel);
      kept++;
    }

    const last = batch.last();
    if (!last) break;
    before = last.id;

    if (scanned % 1000 < 100) {
      console.log(`   … ${salonLabel} : ${scanned} messages parcourus, ${kept} retenus`);
      writeCsv(); // sauvegarde continue : rien n'est perdu si ça s'interrompt
    }
    if (reachedStart) break;
  }

  console.log(`   ✔️  ${salonLabel} : ${kept} messages retenus`);
  return kept;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // ⚠️ à activer dans le portail développeur
  ],
});

client.once('ready', async () => {
  console.log(`🤖 Connecté : ${client.user.tag}`);
  console.log(`📅 Période : du ${START_DATE} au ${END_DATE} (exclu), heure de Paris`);
  console.log(`🔒 Pseudonymisation : ${ANONYMIZE ? 'ACTIVÉE' : 'désactivée'}\n`);

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    console.log(`📚 Canal : #${channel.name}\n`);

    let total = await scanChannel(channel, `#${channel.name}`);

    if (INCLUDE_THREADS) {
      try {
        const active   = await channel.threads.fetchActive();
        const archived = await channel.threads.fetchArchived({ limit: 100 });
        const threads  = [...active.threads.values(), ...archived.threads.values()];
        if (threads.length) console.log(`\n🧵 ${threads.length} fil(s) de discussion à parcourir`);
        for (const t of threads) {
          total += await scanChannel(t, `#${channel.name} > ${t.name}`);
        }
      } catch (e) {
        console.log(`   ⚠️  Fils de discussion inaccessibles (${e.message})`);
      }
    }

    writeCsv();

    const authors = new Set(rows.map(r => r.user_id)).size;
    console.log('\n──────────────────────────────────────');
    console.log(`✅ Export terminé : ${total} messages`);
    console.log(`👥 ${authors} membres distincts`);
    console.log(`📄 Fichier : ${OUT}`);
    console.log('──────────────────────────────────────');
  } catch (e) {
    console.error('❌ Erreur :', e.message);
    console.error('   Vérifie que le bot a accès au canal (Voir le salon + Lire l\'historique)');
    console.error('   et que le Message Content Intent est activé dans le portail développeur.');
  }
  process.exit(0);
});

client.login(TOKEN).catch(e => {
  console.error('❌ Connexion impossible :', e.message);
  process.exit(1);
});
