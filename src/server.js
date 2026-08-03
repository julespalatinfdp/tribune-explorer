import express from 'express';
import fs from 'node:fs';
import { config } from './config.js';
import { listExports, resolveExportPath } from './storage.js';

export function startServer(client) {
  const app = express();

  app.disable('x-powered-by');

  app.get('/', (req, res) => {
    res.json({
      service: 'betclic-tribune-exporter',
      status: 'ok',
      discord: client?.isReady() ? 'connected' : 'disconnected',
      uptimeSec: Math.round(process.uptime()),
    });
  });

  app.get('/health', (req, res) => {
    if (!client?.isReady()) return res.status(503).json({ status: 'starting' });
    res.json({ status: 'healthy' });
  });

  const requireToken = (req, res, next) => {
    if (!config.exportToken) {
      return res.status(404).json({ error: 'Téléchargement HTTP désactivé (EXPORT_TOKEN absent).' });
    }
    const provided = req.query.token || req.get('x-export-token');
    if (provided !== config.exportToken) {
      return res.status(401).json({ error: 'Jeton invalide.' });
    }
    next();
  };

  app.get('/exports', requireToken, async (req, res) => {
    res.json(await listExports());
  });

  app.get('/download/:file', requireToken, (req, res) => {
    const filePath = resolveExportPath(req.params.file);
    if (!filePath.endsWith('.csv') || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fichier introuvable ou expiré.' });
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.download(filePath);
  });

  const server = app.listen(config.port, () => {
    console.log(`[http] serveur en écoute sur le port ${config.port}`);
  });

  return server;
}
