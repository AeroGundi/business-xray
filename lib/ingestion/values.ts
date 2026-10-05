/**
 * Value interpretation: turning cell text into dates, numbers and countries.
 * Kept separate so detection, validation and normalisation agree on what a
 * cell means.
 */

export const isBlank = (s: string): boolean => {
  const t = s.trim().toLowerCase();
  return t === "" || t === "null" || t === "n/a" || t === "na" || t === "nan" || t === "none" || t === "-" || t === "#n/a";
};

/** Form in which identifiers are compared across files: surrounding space and letter case are ignored. */
export const keyOf = (s: string): string => s.trim().toLowerCase();

/** Lower-case, accent-free, punctuation-free form used for all name comparisons. */
export const normalise = (s: string): string =>
  s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Parses "1.234,56", "1,234.56", "€ 79,90", "12%", "(40)". Returns null when the text is not a number. */
export function parseNumber(raw: string): number | null {
  let s = raw.trim();
  if (s === "") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  s = s.replace(/[€$£%\s ]|eur|usd|gbp/gi, "");
  if (s.startsWith("-")) {
    sign = -sign;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const dot = s.lastIndexOf(".");
  const comma = s.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) s = dot > comma ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  else if (comma >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (dot >= 0 && /^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6, jul: 7, aug: 8, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dec: 12, dic: 12,
};

export type DateOrder = "dmy" | "mdy";
const DAY = 86400000;

function build(y: number, m: number, d: number): number | null {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const t = Date.UTC(y, m - 1, d);
  return new Date(t).getUTCDate() === d ? t : null;
}

/** Parses a date into UTC milliseconds at midnight. Numeric day/month order is given by `order`. */
export function parseDate(raw: string, order: DateOrder = "dmy"): number | null {
  const s = raw.trim();
  if (s === "") return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return build(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return build(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s].*)?$/);
  if (m) return order === "dmy" ? build(+m[3], +m[2], +m[1]) : build(+m[3], +m[1], +m[2]);
  const t = normalise(s);
  m = t.match(/^(\d{1,2}) (?:de )?([a-z]{3})[a-z]* (?:de )?(\d{2}|\d{4})$/);
  if (m && MONTHS[m[2]]) return build(+m[3], MONTHS[m[2]], +m[1]);
  m = t.match(/^([a-z]{3})[a-z]* (\d{1,2}) (\d{4})$/);
  if (m && MONTHS[m[1]]) return build(+m[3], MONTHS[m[1]], +m[2]);
  return null;
}

/** Day/month order of a column: decided by any value whose first or second part exceeds 12. */
export function detectDateOrder(values: string[]): { order: DateOrder; ambiguous: boolean } {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    else if (+m[2] > 12) mdy++;
  }
  return { order: mdy > dmy ? "mdy" : "dmy", ambiguous: dmy === 0 && mdy === 0 && values.some((v) => /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(v.trim())) };
}

export const isoDay = (t: number): string => new Date(t).toISOString().slice(0, 10);
export const daysBetween = (a: number, b: number): number => Math.round((b - a) / DAY);
export { DAY };

/** Countries recognised by name (English, Spanish), ISO-2 and ISO-3 code. Unknown values are kept as written. */
const COUNTRY_LIST: [string, string, string, ...string[]][] = [
  ["Spain", "es", "esp", "espana"], ["Germany", "de", "deu", "alemania", "deutschland"], ["France", "fr", "fra", "francia"],
  ["United Kingdom", "gb", "gbr", "uk", "reino unido", "great britain", "england", "inglaterra"], ["Italy", "it", "ita", "italia"],
  ["Portugal", "pt", "prt"], ["Netherlands", "nl", "nld", "paises bajos", "holanda", "holland"], ["Belgium", "be", "bel", "belgica"],
  ["Austria", "at", "aut"], ["Switzerland", "ch", "che", "suiza"], ["Sweden", "se", "swe", "suecia"], ["Norway", "no", "nor", "noruega"],
  ["Denmark", "dk", "dnk", "dinamarca"], ["Finland", "fi", "fin", "finlandia"], ["Ireland", "ie", "irl", "irlanda"], ["Poland", "pl", "pol", "polonia"],
  ["Czechia", "cz", "cze", "czech republic", "republica checa"], ["Greece", "gr", "grc", "grecia"], ["Romania", "ro", "rou", "rumania"],
  ["Hungary", "hu", "hun", "hungria"], ["United States", "us", "usa", "estados unidos", "eeuu", "united states of america"],
  ["Canada", "ca", "can"], ["Mexico", "mx", "mex"], ["Brazil", "br", "bra", "brasil"], ["Argentina", "ar", "arg"], ["Chile", "cl", "chl"],
  ["Colombia", "co", "col"], ["Peru", "pe", "per"], ["Uruguay", "uy", "ury"], ["Ecuador", "ec", "ecu"], ["Australia", "au", "aus"],
  ["New Zealand", "nz", "nzl", "nueva zelanda"], ["Japan", "jp", "jpn", "japon"], ["China", "cn", "chn"], ["India", "in", "ind"],
  ["South Korea", "kr", "kor", "corea del sur", "korea"], ["Singapore", "sg", "sgp", "singapur"], ["United Arab Emirates", "ae", "are", "uae", "emiratos arabes unidos"],
  ["Saudi Arabia", "sa", "sau", "arabia saudi"], ["Turkey", "tr", "tur", "turquia"], ["Israel", "il", "isr"], ["South Africa", "za", "zaf", "sudafrica"],
  ["Morocco", "ma", "mar", "marruecos"], ["Luxembourg", "lu", "lux", "luxemburgo"], ["Andorra", "ad", "and"],
];

const COUNTRY_INDEX = new Map<string, string>();
for (const [name, ...keys] of COUNTRY_LIST) {
  COUNTRY_INDEX.set(normalise(name), name);
  for (const k of keys) COUNTRY_INDEX.set(k, name);
}

/** Canonical English country name, or null when the value is not a known country. */
export const knownCountry = (raw: string): string | null => COUNTRY_INDEX.get(normalise(raw)) ?? null;

/** Canonical name when known; otherwise the value as written, tidied. */
export const toCountry = (raw: string): string => knownCountry(raw) ?? raw.trim().replace(/\s+/g, " ");
