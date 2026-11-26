import { getRegion, regionsOf, type RegionInfo } from "./regions.js";
import type { LearningRegion } from "./contracts.js";

// Claim Regions (#92) are free text, `{ country, name }`; Clue links store the geocoder's Region code (ADR 0004).
// These map one to the other. A name that is a scope ("the north-eastern states"), a place inside a Region, or a
// group of Regions resolves to nothing: a caller fails loudly rather than guessing.

/** Letters NFD doesn't split into a base letter and a mark. */
const FOLD: Record<string, string> = { ı: "i", ø: "o", æ: "ae", ð: "d", ł: "l", đ: "d", ß: "ss", þ: "th", œ: "oe", ĭ: "i" };

/** Accents, case and punctuation off; words single-spaced. */
export function foldRegionName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[ıøæðłđßþœĭ]/g, (c) => FOLD[c] ?? c)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’ʼ`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Words that say what kind of Region a name is, not which one. */
const GENERIC = new Set([
  "oblast", "oblysy", "krai", "kray", "republic", "respublika", "autonomous", "okrug", "province", "provincia", "region",
  "regione", "county", "district", "municipality", "kommune", "kommunia", "kommuneqarfik", "prefecture", "governorate",
  "department", "state", "metropolis", "metropolitan", "of", "the", "de", "del", "do", "da", "dos",
]);

/** Dropped from the geocoder's names only: "Taipei" is Taipei City, but "New York City" isn't New York. */
const GEOCODER_GENERIC = new Set(["city"]);

/** A name without its bracketed parts and generic words. */
const bare = (name: string, geocoder: boolean) =>
  foldRegionName(name.replace(/[([][^)\]]*[)\]]/g, " "))
    .split(" ")
    .filter((w) => w && !GENERIC.has(w) && !(geocoder && GEOCODER_GENERIC.has(w)))
    .join(" ");

/**
 * Other names Claims use for a Region: the English or native name where the geocoder has the other one, or another
 * spelling. Only names of the whole Region: a place inside one, or a group of them, never goes here.
 */
const ALIASES: Record<string, readonly string[]> = {
  "AE-DU": ["Dubai"],
  "AE-RK": ["Ras al Khaimah"],
  "BE-BRU": ["Bruxelles", "Brussel"],
  "BT-13": ["Haa"],
  "CH-GE": ["Geneva"],
  "CH-SG": ["St. Gallen", "St Gallen"],
  "CL-AI": ["Aysén", "Aisén"],
  "CL-AR": ["Araucanía"],
  "CL-MA": ["Magallanes"],
  "CL-RM": ["Santiago Metropolitan"],
  "CZ-PR": ["Praha"],
  "EG-ALX": ["Alexandria"],
  "EG-C": ["Cairo"],
  "EG-GZ": ["Giza"],
  "ES-AS": ["Principado de Asturias"],
  "ES-VC": ["Comunidad Valenciana", "Valencian Community"],
  "FI-03": ["Etelä-Pohjanmaa", "South Ostrobothnia"],
  "FI-04": ["Etelä-Savo", "South Savo"],
  "FI-06": ["Kanta-Häme"],
  "FI-07": ["Keski-Pohjanmaa"],
  "FI-08": ["Keski-Suomi"],
  "FI-10": ["Lappi"],
  "FI-12": ["Pohjanmaa"],
  "FI-13": ["Pohjois-Karjala"],
  "FI-14": ["Pohjois-Pohjanmaa", "North Ostrobothnia"],
  "FI-15": ["Pohjois-Savo", "North Savo"],
  "FI-19": ["Varsinais-Suomi", "Southwest Finland"],
  "FI-02": ["Etelä-Karjala"],
  "GR-69": ["Mount Athos"],
  "GR-A": ["Eastern Macedonia and Thrace", "East Macedonia and Thrace"],
  "GR-A1": ["Attica"],
  "GR-B": ["Central Macedonia"],
  "GR-C": ["Western Macedonia", "West Macedonia"],
  "GR-D": ["Epirus"],
  "GR-E": ["Thessaly"],
  "GR-F": ["Ionian Islands"],
  "GR-G": ["Western Greece", "West Greece"],
  "GR-H": ["Central Greece"],
  "GR-J": ["Peloponnese"],
  "GR-K": ["North Aegean"],
  "GR-L": ["South Aegean"],
  "GR-M": ["Crete"],
  "GT-QZ": ["Quetzaltenango"],
  "HR-01": ["Zagreb County"],
  "HR-03": ["Sisak-Moslavina"],
  "HR-08": ["Primorje-Gorski Kotar"],
  "HR-09": ["Lika-Senj"],
  "HR-13": ["Zadar"],
  "HR-14": ["Osijek-Baranja"],
  "HR-15": ["Šibenik-Knin"],
  "HR-16": ["Vukovar-Srijem", "Vukovar-Syrmia"],
  "HR-17": ["Split-Dalmatia"],
  "HR-18": ["Istria"],
  "HR-19": ["Dubrovnik-Neretva"],
  "HR-21": ["City of Zagreb"],
  "ID-BB": ["Kepulauan Bangka Belitung"],
  "ID-JK": ["Jakarta"],
  "IL-D": ["Southern"],
  "IL-M": ["Central"],
  "IL-Z": ["Northern"],
  "IN-AN": ["Andaman and Nicobar Islands"],
  "IS-1": ["Höfuðborgarsvæðið", "Capital Region"],
  "IT-21": ["Piedmont"],
  "IT-23": ["Aosta Valley"],
  "IT-25": ["Lombardy"],
  "IT-52": ["Tuscany"],
  "IT-75": ["Puglia"],
  "IT-82": ["Sicilia"],
  "IT-88": ["Sardinia"],
  "JO-JA": ["Jerash"],
  "KG-Y": ["Issyk-Kul"],
  "KH-17": ["Siem Reap"],
  "KH-2": ["Battambang"],
  "KR-43": ["Chungbuk"],
  "KR-44": ["Chungnam"],
  "KR-45": ["Jeonbuk"],
  "KR-46": ["Jeonnam"],
  "KR-47": ["Gyeongbuk"],
  "KR-48": ["Gyeongnam"],
  "LA-LP": ["Luang Prabang"],
  "LB-AS": ["North"],
  "LT-AL": ["Alytus"],
  "LT-KL": ["Klaipėda"],
  "LT-KU": ["Kaunas"],
  "LT-MR": ["Marijampolė"],
  "LT-PN": ["Panevėžys"],
  "LT-TA": ["Tauragė"],
  "LT-UT": ["Utena"],
  "LT-VL": ["Vilnius"],
  "MK-73": ["Strumica"],
  "MN-035": ["Orkhon"],
  "MN-037": ["Darkhan-Uul"],
  "MN-039": ["Khentii"],
  "MN-041": ["Khövsgöl", "Khuvsgul"],
  "MN-043": ["Khovd"],
  "MN-051": ["Sükhbaatar"],
  "MN-055": ["Övörkhangai"],
  "MN-057": ["Zavkhan"],
  "MN-065": ["Govi-Altai"],
  "MN-069": ["Bayankhongor"],
  "MN-071": ["Bayan-Ölgii"],
  "MN-073": ["Arkhangai"],
  "MX-DIF": ["Ciudad de México", "Mexico City", "CDMX"],
  "NA-CA": ["Zambezi"],
  "NZ-MWT": ["Manawatu-Whanganui", "Manawatū-Whanganui"],
  "OM-BA": ["Al Batinah North"],
  "OM-BJ": ["Al Batinah South"],
  "OM-BU": ["Al Buraimi"],
  "OM-DA": ["Ad Dakhiliyah"],
  "OM-ZA": ["Ad Dhahirah", "Al Dhahirah"],
  "PA-NB": ["Ngäbe-Buglé"],
  "PH-00": ["Metro Manila"],
  "PL-DS": ["Dolnośląskie"],
  "PL-KP": ["Kujawsko-Pomorskie"],
  "PL-LB": ["Lubuskie"],
  "PL-LD": ["Łódzkie"],
  "PL-LU": ["Lubelskie"],
  "PL-MA": ["Małopolskie"],
  "PL-MZ": ["Mazowieckie", "Masovia"],
  "PL-OP": ["Opolskie"],
  "PL-PD": ["Podlaskie"],
  "PL-PK": ["Podkarpackie"],
  "PL-PM": ["Pomorskie"],
  "PL-SL": ["Śląskie"],
  "PL-WN": ["Warmińsko-Mazurskie"],
  "PL-WP": ["Wielkopolskie"],
  "PL-ZP": ["Zachodniopomorskie"],
  "QA-DA": ["Doha"],
  "QA-KH": ["Al Khor"],
  "QA-MS": ["Al Shamal"],
  "QA-RA": ["Al Rayyan"],
  "RO-B": ["București"],
  "RS-00": ["Belgrade"],
  "RU-AD": ["Adygea"],
  "RU-AL": ["Altai Republic"],
  "RU-ALT": ["Altai Krai"],
  "RU-BU": ["Buryatia"],
  "RU-CU": ["Chuvashia"],
  "RU-IN": ["Ingushetia"],
  "RU-KB": ["Kabardino-Balkaria"],
  "RU-KC": ["Karachay-Cherkessia"],
  "RU-KHM": ["Khanty-Mansi"],
  "RU-KK": ["Khakassia"],
  "RU-KL": ["Kalmykia"],
  "RU-MAG": ["Magadan"],
  "RU-ME": ["Mari El"],
  "RU-MOS": ["Moscow"],
  "RU-MOW": ["Moscow Oblast"],
  "RU-NIZ": ["Nizhny Novgorod"],
  "RU-PRI": ["Primorsky Krai", "Primorye"],
  "RU-SPE": ["Saint Petersburg", "St. Petersburg"],
  "RU-UD": ["Udmurtia"],
  "RU-YAN": ["Yamalo-Nenets"],
  "RU-YEV": ["Jewish Autonomous Oblast"],
  "RU-ZAB": ["Zabaykalsky Krai", "Zabaykalsky"],
  "SK-PV": ["Prešovský"],
  "UA-05": ["Vinnytsia"],
  "UA-21": ["Zakarpattia"],
  "UA-23": ["Zaporizhzhia"],
  "UA-30": ["Kyiv"],
  "UA-32": ["Kyiv Oblast"],
  "UA-35": ["Kirovohrad", "Kropyvnytskyi"],
  "UA-48": ["Mykolaiv"],
  "UA-51": ["Odesa"],
  "UA-68": ["Khmelnytskyi"],
};

interface Entry {
  info: RegionInfo;
  /** Its folded name and aliases. */
  names: string[];
  /** The same without generic words. */
  bare: string[];
}

const byCountry = new Map<string, Entry[]>();

function entries(country: string): Entry[] {
  const c = country.toUpperCase();
  let list = byCountry.get(c);
  if (!list) {
    list = regionsOf(c).map((info) => {
      const all = [info.name, ...(ALIASES[info.code] ?? [])];
      return { info, names: all.map(foldRegionName), bare: all.map((n) => bare(n, true)) };
    });
    byCountry.set(c, list);
  }
  return list;
}

const unspaced = (s: string) => s.replace(/ /g, "");

/**
 * The geocoder Region a Claim's Region name means, within its country: a geocoder code as it is; else the name or a
 * known other name, ignoring case, accents and punctuation; else the same with generic words (Oblast, Province,
 * …) and bracketed parts dropped; else that with spaces dropped too ("Chonburi" is Chon Buri). A level counts only
 * when it leaves exactly one Region. Null when none does.
 */
export function resolveRegionName(country: string, name: string): RegionInfo | null {
  const c = country.toUpperCase();
  const asCode = getRegion(name.trim());
  if (asCode) return asCode.countryCode === c ? asCode : null;
  const list = entries(c);
  const folded = foldRegionName(name);
  const plain = bare(name, false);
  if (!folded || !plain) return null;
  // Each level counts only when it leaves exactly one Region.
  const levels: Array<(e: Entry) => boolean> = [
    (e) => e.names.includes(folded),
    (e) => e.bare.includes(plain),
    (e) => e.bare.some((b) => unspaced(b) === unspaced(plain)),
  ];
  for (const matches of levels) {
    const hits = list.filter(matches);
    if (hits.length === 1) return hits[0]!.info;
    if (hits.length > 1) return null;
  }
  return null;
}

/** Accents off, case kept: Region names are proper nouns, so "Para" names Pará but "para" doesn't. */
const foldKeepCase = (s: string) =>
  s
    .replace(/[ıøæðłđßþœĭ]/g, (ch) => FOLD[ch] ?? ch)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’ʼ`]/g, "");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The Regions a Claim names (#92): its own Regions that resolve, and Regions of its countries whose name (or a
 * known other name) its text spells out as whole words. A scope ("the north-eastern states", "the south") names
 * none. Codes, in the order found.
 */
export function namedRegionsIn(claim: { text: string; countries: readonly string[]; regions: readonly LearningRegion[] }): string[] {
  const found = new Set<string>();
  for (const r of claim.regions) {
    const info = resolveRegionName(r.country, r.name);
    if (info) found.add(info.code);
  }
  const text = foldKeepCase(claim.text);
  const countries = new Set([...claim.countries, ...claim.regions.map((r) => r.country)].map((c) => c.toUpperCase()));
  for (const country of countries) {
    for (const info of regionsOf(country)) {
      if (found.has(info.code)) continue;
      const names = [info.name, ...(ALIASES[info.code] ?? [])].map(foldKeepCase);
      if (names.some((n) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(n)}(?![\\p{L}\\p{N}])`, "u").test(text))) found.add(info.code);
    }
  }
  return [...found];
}
