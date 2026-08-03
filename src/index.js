import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { assertConfig, config } from './config.js';
import { handleInteraction } from './commands.js';
import { startServer } from './server.js';
import { ensureDir, purgeOldExports } from './storage.js';

assertConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // intent privilégié : à activer dans le portail développeur
  ],
  partials: [Partials.Message, Partials.Channel],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[discord] connecté en tant que ${readyClient.user.tag}`);
  await ensureDir();
  const guild = await readyClient.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) {
    console.warn(`[discord] le bot n'est pas présent sur le serveur ${config.guildId}`);
  } else {
    console.log(`[discord] serveur cible : ${guild.name}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await handleInteraction(interaction);
  } catch (error) {
    console.error('[interaction] erreur non gérée :', error);
  }
});

client.on(Events.Error, (error) => console.error('[discord] erreur client :', error));
process.on('unhandledRejection', (error) => console.error('[process] rejet non géré :', error));

startServer(client);

// Purge des exports expirés toutes les heures
setInterval(() => {
  purgeOldExports().catch((err) => console.error('[storage] purge échouée :', err));
}, 60 * 60 * 1000).unref();

client.login(config.token);

const shutdown = async (signal) => {
  console.log(`[process] arrêt demandé (${signal})`);
  await client.destroy().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
