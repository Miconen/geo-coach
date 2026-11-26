// Which countries an Utterance names (#80): every country's name, its common aliases ("Holland", "USA", "Czech
// Republic"), its demonyms ("Danish", "Czech", "Ecuadorian") and its nicknames ("ZA", "Bangla", "Aus", #88). Case and
// accents fold; a term only matches whole words, and the longest term at a position wins, so "Nigeria" never reads as
// Niger and "Papua New Guinea" never as Guinea. Callers pass the corrected Utterance text (transcript rules and manual
// edits applied), not the raw transcription. Pure.
import { ALL_COUNTRIES } from "@geo-coach/shared";

/** Aliases and demonyms beyond the country's own name (ALL_COUNTRIES), by ISO code. */
const EXTRA_TERMS: Record<string, readonly string[]> = {
  AD: ["andorran"],
  AE: ["uae", "emirates", "emirati"],
  AF: ["afghan"],
  AG: ["antigua", "antiguan"],
  AL: ["albanian"],
  AM: ["armenian"],
  AO: ["angolan"],
  AQ: ["antarctic"],
  AR: ["argentine", "argentinian", "argentinean"],
  AS: ["american samoan"],
  AT: ["austrian"],
  AU: ["australian", "aussie"],
  AX: ["aland", "alands", "alandic"],
  AZ: ["azerbaijani", "azeri"],
  BA: ["bosnia", "bosnian", "herzegovina"],
  BB: ["barbadian", "bajan"],
  BD: ["bangladeshi"],
  BE: ["belgian"],
  BF: ["burkinabe"],
  BG: ["bulgarian"],
  BH: ["bahraini"],
  BI: ["burundian"],
  BJ: ["beninese"],
  BM: ["bermudian"],
  BN: ["bruneian"],
  BO: ["bolivian"],
  BR: ["brasil", "brazilian"],
  BS: ["bahamian", "the bahamas"],
  BT: ["bhutanese"],
  BW: ["botswanan", "motswana", "batswana"],
  BY: ["belarusian", "belarussian"],
  BZ: ["belizean"],
  CA: ["canadian"],
  CD: ["drc", "democratic republic of the congo", "congo kinshasa"],
  CF: ["central african"],
  CG: ["congo brazzaville"],
  CH: ["swiss"],
  CI: ["cote d ivoire", "cote divoire", "ivorian"],
  CK: ["cook islander"],
  CL: ["chilean"],
  CM: ["cameroonian"],
  CN: ["chinese"],
  CO: ["colombian"],
  CR: ["costa rican"],
  CU: ["cuban"],
  CV: ["cabo verde", "cape verdean"],
  CW: ["curacaoan"],
  CY: ["cypriot"],
  CZ: ["czech republic", "czech", "czechs"],
  DE: ["german", "deutschland"],
  DJ: ["djiboutian"],
  DK: ["danish", "dane", "danes"],
  DO: ["dominican"],
  DZ: ["algerian"],
  EC: ["ecuadorian", "ecuadorean"],
  EE: ["estonian"],
  EG: ["egyptian"],
  ER: ["eritrean"],
  ES: ["spanish", "espana"],
  ET: ["ethiopian"],
  FI: ["finnish", "finns", "suomi"],
  FJ: ["fijian"],
  FK: ["falklands", "falkland islander"],
  FO: ["faroe", "faroes", "faroese", "faeroe islands"],
  FR: ["french"],
  GA: ["gabonese"],
  GB: [
    "uk",
    "britain",
    "great britain",
    "british",
    "brit",
    "brits",
    "england",
    "scotland",
    "wales",
    "northern ireland",
    "scottish",
    "welsh",
    "northern irish",
  ],
  GD: ["grenadian"],
  GE: ["georgian"],
  GF: ["french guianese"],
  GH: ["ghanaian"],
  GI: ["gibraltarian"],
  GL: ["greenlandic", "greenlander"],
  GM: ["gambian", "the gambia"],
  GN: ["guinean"],
  GP: ["guadeloupean"],
  GQ: ["equatorial guinean"],
  GR: ["greek"],
  GT: ["guatemalan"],
  GU: ["guamanian"],
  GW: ["bissau guinean"],
  GY: ["guyanese"],
  HK: ["hongkong", "hong konger"],
  HN: ["honduran"],
  HR: ["croatian", "croat"],
  HT: ["haitian"],
  HU: ["hungarian"],
  ID: ["indonesian", "indo"],
  IE: ["irish", "eire"],
  IL: ["israeli"],
  IM: ["manx"],
  IN: ["indian"],
  IQ: ["iraqi"],
  IR: ["iranian", "persia", "persian"],
  IS: ["icelandic", "icelander"],
  IT: ["italian"],
  JM: ["jamaican"],
  JO: ["jordanian"],
  JP: ["japanese"],
  KE: ["kenyan"],
  KG: ["kyrgyz", "kyrgyzstani", "kirghizia"],
  KH: ["cambodian", "khmer"],
  KM: ["comoran", "comorian"],
  KN: ["st kitts", "saint kitts", "kittitian"],
  KP: ["north korean", "dprk"],
  KR: ["korea", "korean", "south korean"],
  KW: ["kuwaiti"],
  KY: ["caymans", "caymanian"],
  KZ: ["kazakh", "kazakhstani"],
  LA: ["lao", "laotian"],
  LB: ["lebanese"],
  LC: ["st lucia", "saint lucian", "st lucian"],
  LI: ["liechtensteiner"],
  LK: ["sri lankan", "ceylon"],
  LR: ["liberian"],
  LS: ["basotho", "mosotho"],
  LT: ["lithuanian"],
  LU: ["luxembourgish", "luxembourger"],
  LV: ["latvian"],
  LY: ["libyan"],
  MA: ["moroccan"],
  MC: ["monegasque", "monacan"],
  MD: ["moldovan"],
  ME: ["montenegrin"],
  MG: ["malagasy", "madagascan"],
  MK: ["macedonia", "macedonian", "north macedonian"],
  ML: ["malian"],
  MM: ["burma", "burmese", "myanmarese"],
  MN: ["mongolian"],
  MO: ["macao", "macanese"],
  MP: ["northern marianas", "marianas"],
  MQ: ["martinican", "martiniquais"],
  MR: ["mauritanian"],
  MT: ["maltese"],
  MU: ["mauritian"],
  MV: ["maldivian"],
  MW: ["malawian"],
  MX: ["mexican"],
  MY: ["malaysian"],
  MZ: ["mozambican"],
  NA: ["namibian"],
  NC: ["new caledonian"],
  NE: ["nigerien"],
  NG: ["nigerian"],
  NI: ["nicaraguan"],
  NL: ["holland", "dutch", "the netherlands", "nederland"],
  NO: ["norwegian"],
  NP: ["nepali", "nepalese"],
  NZ: ["new zealander", "kiwi", "nz"],
  OM: ["omani"],
  PA: ["panamanian"],
  PE: ["peruvian"],
  PF: ["french polynesian", "tahiti", "tahitian"],
  PG: ["png", "papua new guinean"],
  PH: ["filipino", "philippine", "pinoy"],
  PK: ["pakistani"],
  PL: ["polish"],
  PM: ["st pierre", "saint pierre"],
  PR: ["puerto rican"],
  PS: ["palestinian", "west bank", "gaza"],
  PT: ["portuguese"],
  PY: ["paraguayan"],
  QA: ["qatari"],
  RE: ["reunionese"],
  RO: ["romanian"],
  RS: ["serbian", "serb"],
  RU: ["russian"],
  RW: ["rwandan"],
  SA: ["saudi", "saudi arabian"],
  SB: ["solomons", "solomon islander"],
  SC: ["seychellois"],
  SD: ["sudanese"],
  SE: ["swedish", "swede", "swedes"],
  SG: ["singaporean"],
  SI: ["slovenian", "slovene"],
  SJ: ["svalbard"],
  SK: ["slovak", "slovakian"],
  SL: ["sierra leonean"],
  SM: ["sammarinese"],
  SN: ["senegalese"],
  SO: ["somali", "somalian"],
  SR: ["surinamese"],
  SS: ["south sudanese"],
  ST: ["sao tome", "santomean"],
  SV: ["salvadoran", "salvadorian"],
  SX: ["st maarten"],
  SY: ["syrian"],
  SZ: ["swaziland", "swazi", "eswatini"],
  TC: ["turks and caicos"],
  TD: ["chadian"],
  TG: ["togolese"],
  TH: ["thai"],
  TJ: ["tajik", "tajikistani"],
  TL: ["east timor", "timor", "timorese"],
  TM: ["turkmen"],
  TN: ["tunisian"],
  TO: ["tongan"],
  TR: ["turkiye", "turkish"],
  TT: ["trinidad", "trinidadian", "tobago"],
  TW: ["taiwanese"],
  TZ: ["tanzanian"],
  UA: ["ukrainian"],
  UG: ["ugandan"],
  US: ["usa", "america", "united states of america", "american", "americans", "the us"],
  UY: ["uruguayan"],
  UZ: ["uzbek", "uzbekistani"],
  VA: ["vatican"],
  VC: ["st vincent", "saint vincent", "vincentian"],
  VE: ["venezuelan"],
  VG: ["bvi"],
  VI: ["usvi"],
  VN: ["viet nam", "vietnamese"],
  VU: ["vanuatuan", "ni vanuatu"],
  WS: ["samoan"],
  XK: ["kosovar", "kosovan"],
  YE: ["yemeni"],
  YT: ["mahoran"],
  ZA: ["south african", "rsa"],
  ZM: ["zambian"],
  ZW: ["zimbabwean"],
};

/**
 * Nicknames Players use in a fast Round (#88): GeoGuessr shorthand, clipped names and codes said as words. Each is a
 * whole word that is neither a common English word nor another country's term. Left out on purpose: "us", "in", "my",
 * "per", "can", "chin", "den", "fin", "ice" (English words); "sa" (South Africa, Saudi Arabia or South America);
 * "para" (also Brazil's Pará); "nam" (also slang for Vietnam); "oz" (ounces); "philly" (Philadelphia); "sk" (South
 * Korea or Slovakia).
 */
const NICKNAMES: Record<string, readonly string[]> = {
  AR: ["argie"],
  AU: ["aus", "straya"],
  BD: ["bangla"],
  DO: ["domrep", "dom rep"],
  EC: ["ecua", "equa"],
  GT: ["guate"],
  HK: ["hk"],
  LU: ["lux"],
  ME: ["monte"],
  MY: ["malay"],
  PH: ["phil"],
  SA: ["ksa"],
  TT: ["trini"],
  VN: ["viet"],
  ZA: ["za"],
  ZW: ["zim"],
};

/** Terms naming more than one country. */
const SHARED_TERMS: Record<string, readonly string[]> = {
  congo: ["CD", "CG"],
  congolese: ["CD", "CG"],
  "virgin islands": ["VG", "VI"],
  guiana: ["GF", "GY"],
};

/**
 * Phrases that contain a country term but name no country; matching them first consumes the words ("South America"
 * isn't the US, "New Guinea" isn't Guinea).
 */
const NON_COUNTRY_TERMS = [
  "south america",
  "north america",
  "central america",
  "latin america",
  "south american",
  "north american",
  "central american",
  "latin american",
  "new guinea",
  "guinea pig",
  "new mexico",
  "new jersey",
  "new england",
  "english channel",
  "monte carlo",
  "three card monte",
];

/** Lowercase, accents and punctuation folded to spaces: "Côte d'Ivoire" → "cote d ivoire". */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildIndex() {
  const terms = new Map<string, Set<string>>();
  const add = (term: string, codes: readonly string[]) => {
    const key = foldText(term);
    if (!key) return;
    const set = terms.get(key) ?? new Set<string>();
    for (const c of codes) set.add(c);
    terms.set(key, set);
  };
  for (const c of ALL_COUNTRIES) add(c.name, [c.code]);
  for (const [code, list] of Object.entries(EXTRA_TERMS)) for (const t of list) add(t, [code]);
  for (const [code, list] of Object.entries(NICKNAMES)) for (const t of list) add(t, [code]);
  for (const [t, codes] of Object.entries(SHARED_TERMS)) add(t, codes);
  for (const t of NON_COUNTRY_TERMS) add(t, []);
  const maxWords = Math.max(...[...terms.keys()].map((t) => t.split(" ").length));
  return { terms, maxWords };
}

let index: ReturnType<typeof buildIndex> | null = null;

/** The ISO codes of every country `text` names, in order of first mention. */
export function countriesNamed(text: string): string[] {
  index ??= buildIndex();
  const words = foldText(text).split(" ").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    let matched = 0;
    for (let n = Math.min(index.maxWords, words.length - i); n > 0; n--) {
      const codes = index.terms.get(words.slice(i, i + n).join(" "));
      if (!codes) continue;
      for (const c of codes) if (!out.includes(c)) out.push(c);
      matched = n;
      break;
    }
    i += matched || 1;
  }
  return out;
}

/** Whether `text` names the country `code`. */
export const namesCountry = (text: string, code: string) => countriesNamed(text).includes(code.toUpperCase());
