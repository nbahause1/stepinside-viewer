/**
 * XSS hardening of the owner report (renderReportHtml in report.ts).
 *
 * Threat model: lead names/contacts, concierge questions, annotation labels
 * and even the property label are attacker-controlled strings that end up in
 * an HTML page the property OWNER opens in their browser. A single unescaped
 * string would let any anonymous visitor run script in the owner's session.
 */
import { describe, it, expect } from 'vitest';
import { renderReportHtml } from '../src/report.js';
import type { ReportData } from '../src/report.js';

const SCRIPT_PAYLOAD = '<script>alert(1)</script>';

function baseData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    propertyId: 'prop-1',
    label: null,
    generatedAt: 1_750_000_000_000,
    opens: 10,
    avgDwellMs: 90_000,
    tourStarts: 5,
    tourCompletes: 3,
    stagings: 2,
    shares: 1,
    ctaClicks: 4,
    annotations: [],
    survey: [0, 0, 0, 0, 0],
    questions: [],
    leads: [],
    ...overrides,
  };
}

describe('renderReportHtml escaping', () => {
  it('escapes a script tag in the lead name', () => {
    const html = renderReportHtml(
      baseData({
        leads: [{ ts: 1_750_000_000_000, name: SCRIPT_PAYLOAD, contact: 'x@y.de', interest: null }],
      }),
    );
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes quotes and tag-breakout attempts in the lead contact', () => {
    const html = renderReportHtml(
      baseData({
        leads: [
          {
            ts: 1_750_000_000_000,
            name: 'Max',
            contact: '"><svg onload=alert(1)>',
            interest: null,
          },
        ],
      }),
    );
    expect(html).not.toContain('<svg');
    expect(html).toContain('&quot;&gt;&lt;svg onload=alert(1)&gt;');
  });

  it('escapes ampersands and markup in the lead interest', () => {
    const html = renderReportHtml(
      baseData({
        leads: [
          {
            ts: 1_750_000_000_000,
            name: 'Max',
            contact: 'x@y.de',
            interest: 'Kauf & <b>Miete</b>',
          },
        ],
      }),
    );
    expect(html).not.toContain('<b>Miete</b>');
    expect(html).toContain('Kauf &amp; &lt;b&gt;Miete&lt;/b&gt;');
  });

  it('escapes script tags, quotes and ampersands in concierge questions', () => {
    const html = renderReportHtml(
      baseData({
        questions: [
          { ts: 1_750_000_000_000, text: `${SCRIPT_PAYLOAD} "quoted" & more` },
        ],
      }),
    );
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &quot;quoted&quot; &amp; more');
  });

  it('escapes the property label used in <title> and <h1>', () => {
    const html = renderReportHtml(baseData({ label: `Villa ${SCRIPT_PAYLOAD} & "Meerblick"` }));
    expect(html).not.toContain('<script');
    expect(html).toContain('Villa &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Meerblick&quot;');
  });

  it('falls back to the (escaped) propertyId when no label is set', () => {
    // propertyId is regex-constrained upstream, but the renderer must not rely on that.
    const html = renderReportHtml(baseData({ propertyId: 'x<script>alert(1)</script>' as string, label: null }));
    expect(html).not.toContain('<script');
  });

  it('escapes annotation labels', () => {
    const html = renderReportHtml(
      baseData({ annotations: [{ label: '<img src=x onerror=alert(1)>', count: 3 }] }),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes single quotes so attribute contexts cannot be broken out of', () => {
    const html = renderReportHtml(
      baseData({
        leads: [{ ts: 1, name: "O'Brien 'x'", contact: 'x@y.de', interest: null }],
      }),
    );
    expect(html).toContain('O&#39;Brien &#39;x&#39;');
  });

  it('produces a document with no <script tag at all under combined attack input', () => {
    const html = renderReportHtml(
      baseData({
        label: SCRIPT_PAYLOAD,
        annotations: [{ label: SCRIPT_PAYLOAD, count: 1 }],
        questions: [{ ts: 1, text: SCRIPT_PAYLOAD }],
        leads: [{ ts: 1, name: SCRIPT_PAYLOAD, contact: SCRIPT_PAYLOAD, interest: SCRIPT_PAYLOAD }],
      }),
    );
    expect(html.toLowerCase()).not.toContain('<script');
  });
});
