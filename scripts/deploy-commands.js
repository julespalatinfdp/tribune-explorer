import { REST, Routes } from 'discord.js';
import { config } from '../src/config.js';
import { commands } from '../src/commands.js';

if (!config.token || !config.clientId || !config.guildId) {
  console.error('DISCORD_TOKEN, DISCORD_CLIENT_ID et GUILD_ID sont requis pour enregistrer les commandes.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(config.token);

try {
  console.log(`Enregistrement de ${commands.length} commande(s) sur le serveur ${config.guildId}…`);
  const data = await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: commands }
  );
  console.log(`✅ ${data.length} commande(s) enregistrée(s) :`, data.map((c) => `/${c.name}`).join(', '));
} catch (error) {
  console.error('❌ Échec de l\'enregistrement :', error);
  process.exit(1);
}
