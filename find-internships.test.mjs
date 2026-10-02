// node --test find-internships.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discordMessages, isUsLocation, parseApplied, selectInternships, sortOut } from './find-internships.mjs';

test('US locations are recognized in every format the source uses', () => {
  for (const loc of ['Seattle, WA', 'NYC', 'SF', 'South SF', 'Texas', 'Remote in USA', 'Remote in US', 'Boston, MA, U.S.', 'United States', 'Arlington, VA', 'Washington, DC', 'New York, NY, USA']) {
    assert.ok(isUsLocation(loc), loc);
  }
  for (const loc of ['Toronto, ON, Canada', 'London, UK', 'Remote in Canada', 'Remote', 'Bangalore, India', 'Montreal, QC, Canada', 'Join us remotely', 'Munich, Germany']) {
    assert.ok(!isUsLocation(loc), loc);
  }
});

test('only open, software, US listings are kept, newest first, non-US locations dropped', () => {
  const now = Date.UTC(2026, 9, 2);
  const base = { active: true, is_visible: true, category: 'Software', terms: ['Summer 2027'], url: 'https://x', sponsorship: 'Other', date_updated: 1 };
  const rows = selectInternships([
    { ...base, company_name: 'Old', title: 'SWE Intern', locations: ['Austin, TX'], date_posted: now / 1000 - 30 * 86400 },
    { ...base, company_name: 'New', title: 'SWE Intern', locations: ['London, UK', 'NYC'], date_posted: now / 1000 - 86400, sponsorship: 'Offers Sponsorship' },
    { ...base, company_name: 'Closed', title: 'SWE Intern', locations: ['NYC'], date_posted: now / 1000, active: false },
    { ...base, company_name: 'Canada', title: 'SWE Intern', locations: ['Toronto, ON, Canada'], date_posted: now / 1000 },
    { ...base, company_name: 'Hardware', title: 'HW Intern', locations: ['NYC'], date_posted: now / 1000, category: 'Hardware' },
  ], now);
  assert.deepEqual(rows.map((r) => r.company), ['New', 'Old']);
  assert.deepEqual(rows[0].locations, ['NYC']);
  assert.equal(rows[0].visa, 'Sponsors visa');
  assert.equal(rows[0].isNew, true);
  assert.equal(rows[1].isNew, false);
});

test('applied.txt: links with optional notes, comments and blank lines ignored', () => {
  const applied = parseApplied('# comment\n\nhttps://a.com/1  applied 10/03, referral\r\n   https://b.com/2\nnot a link\n');
  assert.deepEqual([...applied], [['https://a.com/1', 'applied 10/03, referral'], ['https://b.com/2', '']]);
});

test('new = not seen before and not applied; applied ones are tracked as open or closed', () => {
  const now = Date.UTC(2026, 9, 2);
  const mk = (id, extra = {}) => ({ id, active: true, is_visible: true, category: 'Software', company_name: id, title: 'SWE Intern',
    locations: ['NYC'], terms: [], url: `https://${id}`, sponsorship: 'Other', date_posted: now / 1000, date_updated: 1, ...extra });
  const listings = [mk('seen'), mk('fresh'), mk('appliedOpen'), mk('appliedClosed', { active: false })];
  const rows = selectInternships(listings, now);
  const applied = parseApplied('https://appliedOpen note\nhttps://appliedClosed\nhttps://gone');
  const { open, fresh, appliedEntries } = sortOut(rows, listings, applied, new Set(['seen']), now);
  assert.deepEqual(open.map((r) => r.id).sort(), ['fresh', 'seen']);
  assert.deepEqual(fresh.map((r) => r.id), ['fresh']);
  assert.deepEqual(appliedEntries.map((e) => [e.url, e.status]), [
    ['https://appliedOpen', 'Open'], ['https://appliedClosed', 'Closed'], ['https://gone', 'Not in the source list'],
  ]);
  // First run (no seen.txt): nothing counts as new, so Discord isn't flooded.
  assert.equal(sortOut(rows, listings, applied, null, now).fresh.length, 0);
});

test('Discord: batches of 10 embeds, a capped total, and a summary for the rest', () => {
  const r = { company: 'Acme', title: 'SWE Intern', locations: ['NYC'], terms: ['Summer 2027'], posted: new Date(0), visa: 'Not stated', url: 'https://acme' };
  const msgs = discordMessages(Array(23).fill(r), 'README', 20);
  assert.deepEqual(msgs.map((m) => m.embeds?.length ?? 0), [10, 10, 0]);
  assert.match(msgs[0].content, /23 new US software internships/);
  assert.match(msgs[2].content, /3 more/);
  assert.equal(discordMessages([], 'README').length, 0);
});
