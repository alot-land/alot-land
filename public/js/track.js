/**
 * Campaign attribution + conversion tracking.
 *
 * The site had GA4 installed and fired nothing but pageviews, so there was no
 * way to tell which campaign produced an inquiry. This adds the funnel:
 *
 *   visit → lot viewed → inquiry opened → inquiry submitted → tour requested
 *
 * It also remembers where a visitor came from and attaches that to the GHL
 * form, so the lead itself carries its source into the pipeline. Without that,
 * attribution dies at the page and you are buying ads blind.
 *
 * Plain script, no build step, loaded from the standalone sales page and from
 * every BaseLayout page.
 */
(function () {
  'use strict';

  var STORE = 'alot_attr';
  var MAX_AGE_DAYS = 30;

  // ── Attribution ──────────────────────────────────────────────────────────
  // BOTH touches are kept, on purpose. First touch says what introduced someone
  // to the site; last touch says what was active when they enquired. For paid
  // campaigns last touch is the one that matters — a visitor who found the site
  // organically weeks ago and then clicked a Facebook ad should credit the ad,
  // not "direct". Reporting on first touch alone makes every ad look dead.
  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (!v) return null;
      if (v.first && Date.now() - v.first.t > MAX_AGE_DAYS * 864e5) return null;
      return v;
    } catch (e) { return null; }
  }
  function save(v) { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch (e) {} }

  function readTouch() {
    var q = new URLSearchParams(location.search);
    var t = {}, tagged = false;
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
      var v = q.get(k); if (v) { t[k] = v.slice(0, 80); tagged = true; }
    });
    ['gclid', 'fbclid', 'ttclid', 'msclkid'].forEach(function (k) {
      var v = q.get(k); if (v) { t[k] = v.slice(0, 120); tagged = true; }
    });
    if (!tagged) {
      var ref = document.referrer || '';
      var sameSite = ref && ref.indexOf(location.hostname) !== -1;
      if (sameSite) return null;                 // ordinary navigation — not a new touch
      if (ref) {
        var host = '';
        try { host = new URL(ref).hostname.replace(/^www\./, ''); } catch (e) {}
        if (!host) return null;
        t.utm_source = host;
        t.utm_medium = /google|bing|duckduckgo|yahoo/.test(host) ? 'organic'
          : /facebook|instagram|t\.co|twitter|x\.com|tiktok|youtube|linkedin|pinterest/.test(host) ? 'social'
          : 'referral';
      } else {
        t.utm_source = 'direct'; t.utm_medium = 'none';
      }
    }
    t.t = Date.now();
    t.landing = location.pathname.slice(0, 120);
    t.tagged = tagged;
    return t;
  }

  var store = load() || {};
  var touch = readTouch();
  if (touch) {
    if (!store.first) store.first = touch;
    // Only a tagged or off-site arrival replaces last touch; a plain "direct"
    // hit in the same session must not wipe the campaign that brought them.
    if (!store.last || touch.tagged || touch.utm_medium !== 'none') store.last = touch;
    save(store);
  }
  var attr = store.last || store.first || {};
  var firstAttr = store.first || {};

  function attrParams() {
    var p = {};
    Object.keys(attr).forEach(function (k) {
      if (k === 't' || k === 'tagged' || k === 'landing') return;
      p[k] = attr[k];
    });
    if (firstAttr.utm_source && firstAttr.utm_source !== attr.utm_source) {
      p.first_source = firstAttr.utm_source;
      if (firstAttr.utm_campaign) p.first_campaign = firstAttr.utm_campaign;
    }
    return p;
  }

  // ── GA4 ──────────────────────────────────────────────────────────────────
  function send(name, params) {
    var payload = params || {};
    var a = attrParams();
    Object.keys(a).forEach(function (k) { if (!(k in payload)) payload[k] = a[k]; });
    if (typeof window.gtag === 'function') window.gtag('event', name, payload);
    if (window.__alotTrackDebug) console.log('[track]', name, payload);
  }
  window.alotTrack = send;

  // ── Page-level context ───────────────────────────────────────────────────
  var body = document.body || {};
  var ds = body.dataset || {};
  var lot = ds.lotSlug || null;
  var pageKind = ds.pageKind || (lot ? 'listing' : null);

  function ctx(extra) {
    var o = extra || {};
    if (lot) o.lot = lot;
    if (ds.lotStatus) o.lot_status = ds.lotStatus;
    if (ds.lotPrice) o.lot_price = ds.lotPrice;
    if (pageKind) o.page_kind = pageKind;
    return o;
  }

  if (lot) send('lot_view', ctx());
  if (pageKind === 'sales') send('sales_page_view', ctx());

  // ── Interactions ─────────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a,button') : null;
    if (!a) return;
    var href = (a.getAttribute && a.getAttribute('href')) || '';
    var label = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);

    if (/^tel:/i.test(href))      return send('call_click',  ctx({ label: label }));
    if (/^sms:/i.test(href))      return send('text_click',  ctx({ label: label }));
    if (/^mailto:/i.test(href))   return send('email_click', ctx({ label: label }));

    // Booking a showing or a call — the highest-intent click on the site.
    if (/widget\/(booking|bookings)\//.test(href) || /#(book|showing)/.test(href) || /book (a |your )?(showing|private showing)/i.test(label)) {
      return send('tour_request', ctx({ label: label }));
    }
    if (a.matches && a.matches('.lot, .mini')) {
      return send('lot_card_click', ctx({ lot: (href.split('/listings/')[1] || '').replace(/\/$/, ''), label: label }));
    }
    if (a.hasAttribute && a.hasAttribute('data-inquire')) {
      return send('inquiry_open', ctx({ lot: a.getAttribute('data-inquire') || lot }));
    }
    if (/area.?guide|download/i.test(label)) return send('guide_download', ctx({ label: label }));
  }, true);

  // ── GHL form: stamp attribution on, and catch the submit ────────────────
  function stampForms() {
    var p = attrParams();
    if (!Object.keys(p).length) return;
    document.querySelectorAll('iframe[src*="leadconnector"],iframe[src*="brand.alot.land/widget/form"]').forEach(function (f) {
      var src = f.getAttribute('src');
      if (!src || f.dataset.alotStamped) return;
      try {
        var u = new URL(src, location.origin);
        Object.keys(p).forEach(function (k) { if (!u.searchParams.has(k)) u.searchParams.set(k, p[k]); });
        f.dataset.alotStamped = '1';
        f.setAttribute('src', u.toString());
      } catch (e) {}
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', stampForms);
  else stampForms();

  // GHL posts a message to the parent when a form is submitted.
  window.addEventListener('message', function (ev) {
    if (!ev || !ev.origin || !/leadconnectorhq|msgsndr|alot\.land/.test(ev.origin)) return;
    var d = ev.data;
    var s = typeof d === 'string' ? d : (d && (d.type || d.event || d.action)) || '';
    if (/form[_-]?submit|submitted|formSubmitted/i.test(String(s))) {
      send('inquiry_submit', ctx({ form: (d && d.formId) || undefined }));
    }
  });
})();
