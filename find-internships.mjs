// Every open software engineering internship in the USA:
//   - README.md   the full list, with your applications (applied.txt) in their own section
//   - Discord     internships that are new since the last run (DISCORD_WEBHOOK_URL)
//   - seen.txt    ids already sent to Discord, so nothing is sent twice
// Run: node find-internships.mjs   (Node 18+, no dependencies)
// Runs on GitHub every 6 hours via .github/workflows/internships.yml.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Community-maintained list of tech internships (github.com/SimplifyJobs). The repo is renamed
// every year (Summer2026 -> Summer2027 -> ...); GitHub redirects old names, so this keeps working.
const SOURCE = 'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json';
const SOURCE_PAGE = 'https://github.com/SimplifyJobs/Summer2027-Internships';

// ---- filters: edit these to change what ends up in the list ----
const CATEGORIES = ['Software', 'Software Engineering']; // add 'AI/ML/Data' or 'Quant' to widen
const NEW_DAYS = 7; // "Posted this week" section
const MAX_DISCORD = 50; // per run; the rest are summed up with a link to the README

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

function toRow(l, now) {
  const us = (l.locations ?? []).filter(isUsLocation);
  return {
    id: l.id,
    company: l.company_name,
    title: l.title,
    locations: us.length ? us : l.locations ?? [],
    terms: (l.terms ?? []).filter((t) => t !== 'N/A'),
    posted: new Date(l.date_posted * 1000),
    updated: l.date_updated,
    visa: VISA[l.sponsorship] ?? 'Not stated',
    url: l.url,
    isNew: now - l.date_posted * 1000 < NEW_DAYS * 86_400_000,
  };
}

export function selectInternships(listings, now = Date.now()) {
  return listings
    .filter((l) => l.active && l.is_visible && CATEGORIES.includes(l.category))
    .filter((l) => (l.locations ?? []).some(isUsLocation))
    .map((l) => toRow(l, now))
    .sort((a, b) => b.posted - a.posted);
}

// applied.txt: one Apply link per line (copied from README.md or Discord); text after it is a note.
// Lines starting with # are comments.
export function parseApplied(text) {
  const applied = new Map();
  for (const line of text.split(/\r?\n/)) {
    const [url, ...note] = line.trim().split(/\s+/);
    if (url?.startsWith('http')) applied.set(url, note.join(' '));
  }
  return applied;
}

// Splits the open internships into: ones you applied to, everything else, and the new ones
// (not in seen.txt yet, never something you applied to). seen = null means first run.
export function sortOut(rows, listings, applied, seen, now = Date.now()) {
  const byUrl = new Map(rows.map((r) => [r.url, r]));
  const anyByUrl = new Map(listings.map((l) => [l.url, l]));
  const appliedEntries = [...applied].map(([url, note]) => {
    if (byUrl.has(url)) return { ...byUrl.get(url), status: 'Open', note };
    const l = anyByUrl.get(url);
    return l ? { ...toRow(l, now), status: 'Closed', note } : { url, note, status: 'Not in the source list' };
  });
  const open = rows.filter((r) => !applied.has(r.url));
  const fresh = seen ? open.filter((r) => !seen.has(r.id)) : [];
  return { appliedEntries, open, fresh };
}

// ---- Discord ----
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function embed(r) {
  const color = r.visa === 'Sponsors visa' ? 0x2ecc71 : /No sponsorship|citizens/.test(r.visa) ? 0xe74c3c : 0x5865f2;
  return {
    title: `${r.company} — ${r.title}`.slice(0, 256),
    url: r.url,
    color,
    fields: [
      { name: 'Location', value: where(r.locations).slice(0, 1024) || '—', inline: true },
      { name: 'Season', value: r.terms.join(', ') || '—', inline: true },
      { name: 'Visa', value: r.visa, inline: true },
    ],
    footer: { text: `Posted ${day(r.posted)}` },
  };
}

// Discord allows 10 embeds per message, so new internships go out in batches of 10.
export function discordMessages(rows, readmeUrl, max = MAX_DISCORD) {
  const shown = rows.slice(0, max);
  const messages = [];
  for (let i = 0; i < shown.length; i += 10) {
    messages.push({ embeds: shown.slice(i, i + 10).map(embed) });
  }
  if (messages.length) messages[0].content = `**${plural(rows.length, 'new US software internship')}**`;
  if (rows.length > max) {
    messages.push({ content: `…and ${rows.length - max} more. Full list: ${readmeUrl}` });
  }
  return messages;
}

async function postDiscord(webhook, messages) {
  for (const body of messages) {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) break;
      // Rate limited: Discord says how long to wait.
      if (res.status === 429 && attempt < 5) {
        const { retry_after: wait = 2 } = await res.json().catch(() => ({}));
        await new Promise((r) => setTimeout(r, wait * 1000 + 250));
        continue;
      }
      throw new Error(`Discord rejected the message: HTTP ${res.status} ${await res.text()}`);
    }
    await new Promise((r) => setTimeout(r, 1000)); // stay well under the webhook rate limit
  }
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

function appliedTable(entries) {
  if (!entries.length) return '_None yet. Add Apply links to [applied.txt](applied.txt), one per line._\n';
  const head = '| Company | Role | Status | Note | Link |\n|---|---|---|---|---|\n';
  return head + entries.map((e) =>
    `| ${cell(e.company ?? '—')} | ${cell(e.title ?? '—')} | ${e.status} | ${cell(e.note || '—')} | [Posting](${e.url}) |`,
  ).join('\n') + '\n';
}

export function renderMarkdown({ open, fresh, appliedEntries }) {
  const week = open.filter((r) => r.isNew);
  const count = (v) => open.filter((r) => r.visa === v).length;
  // Date of the newest change in the data (not "now"), so the file only changes when the list does.
  const asOf = open.length ? day(new Date(Math.max(...open.map((r) => r.updated)) * 1000)) : 'n/a';
  return `# US Software Engineering Internships

**${open.length} open internships** you haven't applied to · **${fresh.length} new** since the last check ·
**${week.length}** posted in the last ${NEW_DAYS} days · **${appliedEntries.length}** applied · data as of ${asOf}

Refreshed every 6 hours by GitHub Actions (\`.github/workflows/internships.yml\`) from the
community-maintained [SimplifyJobs internship list](${SOURCE_PAGE}): open listings, software engineering,
located in the USA (or remote in the USA). New ones are also posted to Discord.

**Applied to one?** Copy its Apply link into [applied.txt](applied.txt) (one per line, a note after it is
fine). It moves to the Applied section and is never sent to Discord again.

**Visa column** (as reported by the source): ${count('Sponsors visa')} sponsor a visa ·
${count('No sponsorship')} don't sponsor · ${count('US citizens only')} require US citizenship ·
the rest don't say, so check the posting.

## New since the last check

${table(fresh)}
## Applied

${appliedTable(appliedEntries)}
## Posted this week

${table(week)}
## All open internships

${table(open)}`;
}

// ---- run ----
const here = (file) => fileURLToPath(new URL(`./${file}`, import.meta.url));
const readIf = (file) => (existsSync(here(file)) ? readFileSync(here(file), 'utf8') : null);

async function main() {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`Could not download listings: HTTP ${res.status}`);
  const listings = await res.json();
  const rows = selectInternships(listings);
  // A sudden empty result means the source changed shape - keep the last good files instead.
  if (!rows.length) throw new Error('0 internships matched; the source format may have changed. Nothing updated.');

  const applied = parseApplied(readIf('applied.txt') ?? '');
  const seenText = readIf('seen.txt');
  const seen = seenText === null ? null : new Set(seenText.split(/\s+/).filter(Boolean));
  const result = sortOut(rows, listings, applied, seen);

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  const repo = process.env.GITHUB_REPOSITORY; // set by GitHub Actions
  const readmeUrl = repo ? `https://github.com/${repo}#readme` : 'README.md';
  let rememberSeen = true;

  if (process.env.DISCORD_TEST === 'true') {
    if (!webhook) throw new Error('DISCORD_TEST needs the DISCORD_WEBHOOK_URL secret.');
    await postDiscord(webhook, [{ content: '✅ Test from the internship tracker: the 3 newest listings look like this.' }, ...discordMessages(result.open.slice(0, 3), readmeUrl).map(({ embeds }) => ({ embeds }))]);
    console.log('Test message sent to Discord.');
  }

  if (seen === null) {
    // First run: remember everything that exists today instead of sending 1000+ messages.
    console.log(`First run: recording ${rows.length} current internships; only new ones will be sent from now on.`);
    if (webhook) await postDiscord(webhook, [{ content: `Tracking **${rows.length}** open US software internships. New ones will be posted here. List: ${readmeUrl}` }]);
  } else if (result.fresh.length && webhook) {
    await postDiscord(webhook, discordMessages(result.fresh, readmeUrl));
    console.log(`Sent ${result.fresh.length} new internships to Discord.`);
  } else if (result.fresh.length) {
    // Keep them "unseen" so they are sent once the webhook is configured.
    console.warn(`::warning::${result.fresh.length} new internships not sent: add the DISCORD_WEBHOOK_URL secret.`);
    rememberSeen = false;
  }

  writeFileSync(here('README.md'), renderMarkdown(result));
  if (rememberSeen) writeFileSync(here('seen.txt'), rows.map((r) => r.id).sort().join('\n') + '\n');
  console.log(`${result.open.length} open, ${result.fresh.length} new, ${result.appliedEntries.length} applied.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
