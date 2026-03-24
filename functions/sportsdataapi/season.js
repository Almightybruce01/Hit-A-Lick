function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function ymd(date) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function seasonKeyForSport(dateInput, sport) {
  const d = parseDate(dateInput) || new Date();
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;

  if (sport === "mlb") {
    return `${year}`;
  }

  // NBA/WNBA/NFL seasons generally roll over around Jul/Aug.
  if (month >= 8) return `${year}-${year + 1}`;
  return `${year - 1}-${year}`;
}

function keepSeasonKeys(sport, now = new Date()) {
  const current = seasonKeyForSport(now, sport);
  if (sport === "mlb") {
    const y = Number(current);
    return [String(y), String(y - 1)];
  }
  const [a, b] = current.split("-").map((x) => Number(x));
  return [`${a}-${b}`, `${a - 1}-${b - 1}`];
}

function isHistoricalDate(dateInput, now = new Date()) {
  const d = parseDate(dateInput);
  if (!d) return false;
  const day = ymd(d);
  const today = ymd(now);
  return day < today;
}

function retentionCutoffDate(now = new Date()) {
  // keep roughly current + previous season windows.
  const cutoff = new Date(now.getTime());
  cutoff.setUTCDate(cutoff.getUTCDate() - 730);
  return cutoff;
}

export {
  parseDate,
  ymd,
  seasonKeyForSport,
  keepSeasonKeys,
  isHistoricalDate,
  retentionCutoffDate,
};

