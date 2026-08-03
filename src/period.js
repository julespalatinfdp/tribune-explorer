/**
 * Gestion des périodes d'export en heure de Paris.
 *
 * Formats acceptés :
 *   - "2026-06"      → mois entier
 *   - "2026-06-15"   → jour précis
 *
 * La borne de fin est TOUJOURS inclusive : `jusqua:2026-07` inclut
 * le 31 juillet à 23:59:59, et `jusqua:2026-07-31` inclut toute la journée.
 */

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function parisOffsetMs(utcMs) {
  // Le formateur n'expose pas les millisecondes : on compare sur des secondes pleines,
  // sinon le décalage calculé est faussé de quelques centaines de ms.
  const truncated = Math.floor(utcMs / 1000) * 1000;
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(new Date(truncated)).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - truncated;
}

/**
 * Construit une Date à partir d'une heure locale parisienne.
 * Double passe pour gérer correctement les changements d'heure été/hiver.
 */
export function fromParisWallTime(year, month, day, hour = 0, minute = 0, second = 0, ms = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const firstOffset = parisOffsetMs(guess);
  const corrected = guess - firstOffset;
  const secondOffset = parisOffsetMs(corrected);
  return new Date(guess - secondOffset);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Convertit une saisie utilisateur en borne de début ou de fin.
 * @param {string} input  "2026-06" ou "2026-06-15"
 * @param {'start'|'end'} edge
 */
export function parseBoundary(input, edge, label = 'période') {
  if (!input) return null;
  const value = String(input).trim();

  const monthMatch = /^(\d{4})-(\d{2})$/.exec(value);
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!monthMatch && !dayMatch) {
    throw new Error(
      `Le paramètre \`${label}\` doit être au format AAAA-MM (mois entier) ou AAAA-MM-JJ. Reçu : « ${value} ».`
    );
  }

  const year = Number((monthMatch ?? dayMatch)[1]);
  const month = Number((monthMatch ?? dayMatch)[2]);
  if (month < 1 || month > 12) throw new Error(`Mois invalide dans \`${label}\` : ${value}.`);

  const day = dayMatch ? Number(dayMatch[3]) : edge === 'start' ? 1 : daysInMonth(year, month);
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`Jour invalide dans \`${label}\` : ${value}.`);
  }

  const date =
    edge === 'start'
      ? fromParisWallTime(year, month, day, 0, 0, 0, 0)
      : fromParisWallTime(year, month, day, 23, 59, 59, 999);

  if (Number.isNaN(date.getTime())) throw new Error(`Date invalide pour \`${label}\` : ${value}.`);
  return date;
}

/**
 * Résout une période complète et vérifie sa cohérence.
 */
export function resolvePeriod({ depuis, jusqua } = {}) {
  const afterDate = parseBoundary(depuis, 'start', 'depuis');
  const beforeDate = parseBoundary(jusqua, 'end', 'jusqua');

  if (afterDate && beforeDate && afterDate > beforeDate) {
    throw new Error('La date de début est postérieure à la date de fin.');
  }

  return {
    afterDate,
    beforeDate,
    label: formatPeriodLabel(afterDate, beforeDate),
    slug: buildSlug(afterDate, beforeDate),
  };
}

function isoDay(date) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(date);
}

export function formatPeriodLabel(afterDate, beforeDate) {
  if (!afterDate && !beforeDate) return 'historique complet';
  if (afterDate && !beforeDate) return `depuis le ${isoDay(afterDate)}`;
  if (!afterDate && beforeDate) return `jusqu'au ${isoDay(beforeDate)}`;
  return `du ${isoDay(afterDate)} au ${isoDay(beforeDate)}`;
}

function buildSlug(afterDate, beforeDate) {
  if (!afterDate && !beforeDate) return 'complet';
  const start = afterDate ? isoDay(afterDate) : 'debut';
  const end = beforeDate ? isoDay(beforeDate) : 'aujourdhui';
  return `${start}_${end}`;
}

/**
 * Regroupe les lignes CSV par mois (clé "AAAA-MM", heure de Paris).
 */
export function groupByMonth(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.mois || row.date_paris.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}
