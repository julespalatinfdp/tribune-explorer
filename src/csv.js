import { config } from './config.js';

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Échappe une valeur pour un fichier CSV (RFC 4180).
 */
export function escapeField(value, options = {}) {
  const {
    delimiter = config.csvDelimiter,
    flattenNewlines = config.flattenNewlines,
    sanitizeFormulas = config.sanitizeFormulas,
  } = options;

  if (value === null || value === undefined) return '';

  let str = String(value);

  // Neutralise les caractères de contrôle exotiques
  // eslint-disable-next-line no-control-regex
  str = str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  if (flattenNewlines) {
    str = str.replace(/\r\n|\r|\n/g, '\\n');
  }

  // Protection contre l'injection de formules (Excel / LibreOffice / Sheets)
  if (sanitizeFormulas && str.length > 0 && FORMULA_PREFIXES.includes(str[0])) {
    str = `'${str}`;
  }

  const mustQuote =
    str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r');

  if (mustQuote) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Construit la ligne d'en-tête à partir des clés fournies.
 */
export function buildHeader(headers, options = {}) {
  const delimiter = options.delimiter ?? config.csvDelimiter;
  return headers.map((h) => escapeField(h, options)).join(delimiter);
}

/**
 * Sérialise une ligne (objet) selon l'ordre des en-têtes.
 */
export function buildRow(row, headers, options = {}) {
  const delimiter = options.delimiter ?? config.csvDelimiter;
  return headers.map((h) => escapeField(row[h], options)).join(delimiter);
}

/**
 * Sérialise un tableau complet en chaîne CSV.
 */
export function toCsv(rows, headers, options = {}) {
  const bom = options.bom ?? config.csvBom;
  const lines = [buildHeader(headers, options)];
  for (const row of rows) {
    lines.push(buildRow(row, headers, options));
  }
  return (bom ? '\uFEFF' : '') + lines.join('\r\n') + '\r\n';
}
