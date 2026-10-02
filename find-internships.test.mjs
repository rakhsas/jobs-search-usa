// node --test find-internships.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUsLocation, selectInternships } from './find-internships.mjs';

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
