// Builds README.md in this folder: every open software engineering internship in the USA.
// Run: node find-internships.mjs   (Node 18+, no dependencies)
// Runs on GitHub every 6 hours via .github/workflows/internships.yml.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Community-maintained list of tech internships (github.com/SimplifyJobs). The repo is renamed
// every year (Summer2026 -> Summer2027 -> ...); GitHub redirects old names, so this keeps working.
const SOURCE = 'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json';
const SOURCE_PAGE = 'https://github.com/SimplifyJobs/Summer2027-Internships';

// ---- filters: edit these to change what ends up in the list ----
const CATEGORIES = ['Software', 'Software Engineering']; // add 'AI/ML/Data' or 'Quant' to widen
const NEW_DAYS = 7; // "New this week" section

const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia', PR: 'Puerto Rico',
};
const US_WORDS = new Set([
  ...Object.keys(STATES), ...Object.values(STATES).map((s) => s.toUpperCase()),
  'US', 'USA', 'UNITED STATES', 'SF', 'NYC', 'LA', 'SOUTH SF', 'BAY AREA',
]);

// "Seattle, WA" / "Texas" / "NYC" / "Remote in USA" -> true; "Toronto, ON, Canada" / "London, UK" -> false.
export function isUsLocation(loc) {
  const s = loc.trim();
  // "US" must be uppercase so ordinary words ("join us") never match.
  if (/\b(USA?|U\.S\.(A\.)?)(?![\w.])/.test(s) || /\bUnited States\b/i.test(s)) return true;
  const last = s.split(',').pop().trim().toUpperCase();
  return US_WORDS.has(last);
}

const VISA = {
  'Offers Sponsorship': 'Sponsors visa',
  'Does Not Offer Sponsorship': 'No sponsorship',
  'U.S. Citizenship is Required': 'US citizens only',
};

export function selectInternships(listings, now = Date.now()) {
  return listings
    .filter((l) => l.active && l.is_visible && CATEGORIES.includes(l.category))
    .map((l) => ({ ...l, usLocations: (l.locations ?? []).filter(isUsLocation) }))
    .filter((l) => l.usLocations.length > 0)
    .map((l) => ({
      company: l.company_name,
      title: l.title,
      locations: l.usLocations,
      terms: (l.terms ?? []).filter((t) => t !== 'N/A'),
      posted: new Date(l.date_posted * 1000),
      updated: l.date_updated,
      visa: VISA[l.sponsorship] ?? 'Not stated',
      url: l.url,
      isNew: now - l.date_posted * 1000 < NEW_DAYS * 86_400_000,
    }))
    .sort((a, b) => b.posted - a.posted);
}

// ---- markdown ----
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const day = (d) => d.toISOString().slice(0, 10);
const where = (locs) => (locs.length > 3 ? `${locs.slice(0, 3).join(', ')} +${locs.length - 3} more` : locs.join(', '));

function table(rows) {
  if (!rows.length) return '_Nothing here right now._\n';
  const head = '| Company | Role | Location | Season | Posted | Visa | Apply |\n|---|---|---|---|---|---|---|\n';
  return head + rows.map((r) =>
    `| ${cell(r.company)} | ${cell(r.title)} | ${cell(where(r.locations))} | ${cell(r.terms.join(', ') || '—')} | ${day(r.posted)} | ${r.visa} | [Apply](${r.url}) |`,
  ).join('\n') + '\n';
}

export function renderMarkdown(rows) {
  const fresh = rows.filter((r) => r.isNew);
  const count = (v) => rows.filter((r) => r.visa === v).length;
  // Date of the newest change in the data (not "now"), so the file only changes when the list does.
  const asOf = rows.length ? day(new Date(Math.max(...rows.map((r) => r.updated)) * 1000)) : 'n/a';
  return `# US Software Engineering Internships

**${rows.length} open internships** in the USA · **${fresh.length} new** in the last ${NEW_DAYS} days · data as of ${asOf}

Refreshed automatically every 6 hours by GitHub Actions (\`.github/workflows/internships.yml\`) from the
community-maintained [SimplifyJobs internship list](${SOURCE_PAGE}). Only listings that are still open,
in a software engineering category, and located in the USA (or remote in the USA) are kept.

**Visa column** (as reported by the source): ${count('Sponsors visa')} sponsor a visa ·
${count('No sponsorship')} don't sponsor · ${count('US citizens only')} require US citizenship ·
the rest don't say, so check the posting.

## New this week

${table(fresh)}
## All open internships

${table(rows)}`;
}

// ---- run ----
async function main() {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`Could not download listings: HTTP ${res.status}`);
  const rows = selectInternships(await res.json());
  // A sudden empty result means the source changed shape - keep the last good list instead.
  if (!rows.length) throw new Error('0 internships matched; the source format may have changed. README left untouched.');
  const out = fileURLToPath(new URL('./README.md', import.meta.url));
  writeFileSync(out, renderMarkdown(rows));
  console.log(`${rows.length} internships (${rows.filter((r) => r.isNew).length} new) -> ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
