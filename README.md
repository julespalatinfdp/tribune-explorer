# Betclic Tribune Exporter

Bot Discord qui exporte **tous les messages du canal La Tribune** (serveur Betclic France) au format **CSV**, via une commande slash ou en ligne de commande.

- Pagination complète de l'historique (API officielle Discord, 100 messages par lot)
- Inclusion optionnelle des **fils de discussion** (actifs + archivés, publics et privés)
- CSV prêt pour Excel FR : séparateur `;`, BOM UTF-8, protection anti-injection de formules
- Filtres par période en heure de Paris, bornes **inclusives** (`depuis` / `jusqua`)
- Découpage optionnel en un fichier CSV par mois
- Mode **pseudonymisation** (RGPD) : identités hashées en SHA-256
- Livraison en pièce jointe Discord, ou lien de téléchargement privé si le fichier dépasse 8 Mo

---

## 1. Arborescence

```
betclic-tribune-exporter/
├── src/
│   ├── index.js          # point d'entrée : client Discord + serveur HTTP
│   ├── config.js         # variables d'environnement
│   ├── commands.js       # commandes slash /export-tribune et /export-status
│   ├── exporter.js       # pagination des messages + fils
│   ├── mapper.js         # message Discord → ligne CSV
│   ├── csv.js            # sérialisation CSV (RFC 4180)
│   ├── period.js         # périodes, fuseau Europe/Paris, découpage mensuel
│   ├── storage.js        # écriture des fichiers + purge
│   └── server.js         # /health, /exports, /download/:file
├── scripts/
│   ├── deploy-commands.js # enregistrement des commandes slash
│   └── export-cli.js      # export ponctuel en local
├── exports/               # fichiers générés (ignorés par git)
├── .env.example
├── railway.json
└── package.json
```

## 2. Créer l'application Discord

1. https://discord.com/developers/applications → **New Application**
2. Onglet **Bot** → *Reset Token* → copier le token (`DISCORD_TOKEN`)
3. Toujours dans **Bot**, activer l'intent privilégié **MESSAGE CONTENT INTENT** (obligatoire pour lire le contenu des messages)
4. Onglet **General Information** → copier l'**Application ID** (`DISCORD_CLIENT_ID`)
5. Onglet **OAuth2 → URL Generator** :
   - Scopes : `bot`, `applications.commands`
   - Permissions : `View Channels`, `Read Message History`, `Send Messages`, `Attach Files`
6. Ouvrir l'URL générée et inviter le bot sur le serveur Betclic France

> Le bot doit avoir accès en lecture au canal La Tribune. Si le canal a des permissions restreintes, ajoute explicitement le rôle du bot dans les autorisations du salon.

Pour récupérer les IDs : Paramètres Discord → Avancés → **Mode développeur**, puis clic droit sur le serveur / le canal → *Copier l'identifiant*.

## 3. Installation locale

```bash
npm install
cp .env.example .env   # puis complète les valeurs
npm run deploy:commands
npm start
```

Export ponctuel sans passer par Discord :

```bash
# Juin + juillet 2026 dans un seul fichier
npm run export:cli -- --depuis=2026-06 --jusqua=2026-07

# Un fichier CSV par mois
npm run export:cli -- --depuis=2026-06 --jusqua=2026-07 --par-mois

# Bornes au jour près, sans les fils
npm run export:cli -- --depuis=2026-06-15 --jusqua=2026-07-15 --sans-fils
```

Le fichier atterrit dans `exports/`.

## 4. Déploiement GitHub

```bash
git init
git add .
git commit -m "feat: bot d'export CSV du canal La Tribune"
git branch -M main
git remote add origin https://github.com/<compte>/betclic-tribune-exporter.git
git push -u origin main
```

⚠️ Vérifie que `.env` n'est **jamais** commité (il est dans `.gitignore`). Si un token fuite, régénère-le immédiatement dans le portail développeur.

## 5. Déploiement Railway

1. https://railway.app → **New Project** → *Deploy from GitHub repo* → sélectionner le dépôt
2. Onglet **Variables** → ajouter les variables du `.env.example` :

| Variable | Obligatoire | Valeur |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | token du bot |
| `DISCORD_CLIENT_ID` | ✅ | Application ID |
| `GUILD_ID` | ✅ | ID du serveur Betclic France |
| `TRIBUNE_CHANNEL_ID` | recommandé | ID du canal La Tribune |
| `EXPORT_TOKEN` | recommandé | chaîne aléatoire longue |
| `ANONYMIZE_SALT` | si RGPD | chaîne aléatoire |
| `INCLUDE_THREADS` | non | `true` / `false` |

3. Onglet **Settings → Networking** → *Generate Domain* (nécessaire pour le healthcheck et les liens de téléchargement). `PUBLIC_URL` se déduit automatiquement de `RAILWAY_PUBLIC_DOMAIN`.
4. Le déploiement démarre tout seul (`npm start`, healthcheck sur `/health`).
5. Enregistre les commandes slash une fois : Railway → onglet du service → **Command Palette / Shell**, ou en local avec le même `.env` :

```bash
npm run deploy:commands
```

## 6. Utilisation

Dans Discord :

```
/export-tribune depuis:2026-06 jusqua:2026-07
/export-tribune depuis:2026-06 jusqua:2026-07 un-fichier-par-mois:true
/export-tribune depuis:2026-06-15 jusqua:2026-07-15 fils:false
/export-tribune                                    ← historique complet
/export-status
```

### Format des bornes

| Saisie | Interprétation (heure de Paris) |
|---|---|
| `depuis:2026-06` | 1er juin, 00:00:00 |
| `jusqua:2026-07` | 31 juillet, 23:59:59 — **mois entier inclus** |
| `depuis:2026-06-15` | 15 juin, 00:00:00 |
| `jusqua:2026-07-15` | 15 juillet, 23:59:59 — **journée entière incluse** |

Les deux paramètres sont optionnels : sans borne, le bot remonte tout l'historique. Le nom du fichier reprend la période (`betclic-tribune_la-tribune_2026-06-01_2026-07-31.csv`), et le CSV contient une colonne `mois` (`2026-06`, `2026-07`) pour filtrer ou pivoter directement dans Excel.

La réponse est **éphémère** (visible uniquement par toi) et détaille le volume mois par mois. Le CSV arrive en pièce jointe s'il fait moins de 8 Mo, sinon sous forme de lien privé valable 24 h. Avec `un-fichier-par-mois:true`, jusqu'à 10 fichiers sont joints d'un coup.

## 7. Colonnes du CSV

| Colonne | Description |
|---|---|
| `message_id` | identifiant du message |
| `channel_id` / `channel_name` | canal parent |
| `thread_id` / `thread_name` | fil de discussion (vide si message du canal) |
| `mois` | `AAAA-MM` en heure de Paris — pratique pour les tableaux croisés |
| `date_paris` | horodatage `AAAA-MM-JJ HH:MM:SS` en heure de Paris |
| `timestamp_utc` / `edited_utc` | ISO 8601 UTC |
| `author_id` / `author_username` / `author_display_name` | auteur |
| `author_is_bot` | `true` / `false` |
| `content` / `content_length` | texte du message |
| `reply_to_message_id` | message auquel il répond |
| `attachments_count` / `_names` / `_urls` | pièces jointes |
| `embeds_count` / `embed_titles` | embeds |
| `stickers` | stickers utilisés |
| `reactions` / `reactions_total` | `emoji:nombre \| emoji:nombre` |
| `mentions_users` / `mentions_roles` / `mentions_everyone` | mentions |
| `is_pinned`, `message_type`, `jump_url` | métadonnées |

## 8. Points d'attention

**Volumétrie et durée.** L'API Discord plafonne à 100 messages par requête. Un canal de 100 000 messages représente ~1 000 requêtes, soit une dizaine de minutes avec le délai de sécurité de 300 ms. `discord.js` gère automatiquement les rate limits. Un export borné à deux mois est nettement plus rapide : le bot part de la date de fin et s'arrête dès qu'il franchit la date de début, sans parcourir le reste de l'historique.

**Fils de discussion.** Un fil ouvert en mai mais actif en juin est bien pris en compte : le filtre s'applique à la date de chaque message, pas à celle de création du fil. En revanche, l'API ne renvoie que les 100 derniers fils archivés — si La Tribune en compte davantage, les plus anciens échapperont à l'export.

**Disque éphémère.** Railway réinitialise le système de fichiers à chaque redéploiement : les CSV de `exports/` disparaissent. Télécharge-les immédiatement, ou branche un volume Railway sur `/app/exports` si tu veux les conserver.

**Pièces jointes.** Les URLs de fichiers Discord expirent désormais au bout de ~24 h. Si tu as besoin des médias, télécharge-les rapidement après l'export.

**RGPD.** Un export de messages contient des données personnelles (pseudonymes, IDs, contenus). Conserve-le sur un support maîtrisé, limite la diffusion, et utilise `pseudonymiser:true` pour les analyses statistiques qui n'ont pas besoin des identités. Vérifie avec Betclic que la finalité de l'export est couverte par la politique de confidentialité du serveur.

**Sécurité.** Restreins l'accès à la commande via `AUTHORIZED_USER_IDS` / `AUTHORIZED_ROLE_IDS` — par défaut, seuls les membres avec la permission « Gérer le serveur » peuvent lancer un export.

## 9. Dépannage

| Symptôme | Cause probable |
|---|---|
| Colonne `content` vide | Intent **MESSAGE CONTENT** non activé dans le portail développeur |
| `Canal introuvable` | `TRIBUNE_CHANNEL_ID` erroné, ou bot sans accès au salon |
| Commande absente dans Discord | `npm run deploy:commands` non exécuté, ou mauvais `GUILD_ID` |
| Healthcheck Railway en échec | Domaine non généré, ou bot pas encore connecté (délai < 120 s) |
| Accents cassés dans Excel | Ouvrir via *Données → À partir d'un fichier texte* en UTF-8, ou garder `CSV_BOM=true` |
| `doit être au format AAAA-MM` | Saisir `2026-06`, pas `juin` ni `06/2026` |
| Export vide sur la période | Vérifier l'année saisie et que le canal a bien de l'activité sur ces mois |
