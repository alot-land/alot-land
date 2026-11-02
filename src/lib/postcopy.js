/**
 * Ready-to-post copy, generated from the listing record.
 *
 * Generated rather than written once so it cannot go stale: change a price or
 * an acreage in the CMS and the copy changes with it. Nothing here asserts
 * anything the listing does not already state.
 *
 * The two formats are deliberately different. A Marketplace listing is a
 * classified ad and should read like one — scannable, specifics first. A group
 * post that reads like an advert gets deleted by the moderator and resented by
 * the members, so it is written as a person talking about land they own.
 */

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function lotFacts(lot) {
  const d = lot.data;
  const num = (d.title.match(/Lot\s+(\d+)/) || [])[1] || '';
  const name = d.title.replace(/^Lot\s+\d+\s*[—-]\s*/i, '').trim();
  // First line of the body, with the markdown emphasis stripped.
  const hook = clean((lot.body.split('\n').map(s => s.trim()).find(Boolean) || '').replace(/[*_]{1,3}/g, ''));
  return {
    num, name, hook,
    acreage: d.acreage,
    price: d.hidePrice ? '' : (d.price || ''),
    county: d.county,
    state: d.state,
    slug: lot.slug,
  };
}

/** Facebook Marketplace: title, price, and a description that scans. */
export function marketplaceListing(lot, link) {
  const f = lotFacts(lot);
  const title = `${f.acreage} Acres — Unrestricted Land, ${f.county} County TN`;
  const body = [
    `${f.acreage} acres in ${f.county} County, Tennessee — about 90 minutes from Nashville and minutes from the Tennessee River at Kentucky Lake.`,
    '',
    f.hook,
    '',
    'What comes with it:',
    '• Power at the road, high-speed internet available',
    '• Soil map included — you can place a septic where you decide to build',
    '• Graded driveway already in',
    '• New survey, warranty deed, clear title',
    '• Unrestricted — no HOA, no build time limit',
    '• Cabins, homes, RVs and travel trailers all fine',
    '',
    'Good for a weekend place, a hunting tract, or somewhere to build when you are ready.',
    '',
    `Photos, survey and full details: ${link}`,
    '',
    'Call or text Tony Alcott, our listing agent, on (731) 607-2221.',
  ].join('\n');
  return { title, price: f.price, category: 'Property for Sale → Land', body };
}

/**
 * Group post. Written to survive a moderator: no sales language, no urgency,
 * the price stated plainly rather than teased, and an offer to answer questions.
 */
export function groupPost(lot, link) {
  const f = lotFacts(lot);
  const priceLine = f.price ? ` Asking ${f.price}.` : '';
  return [
    `${f.acreage} acres in ${f.county} County, about 90 minutes from Nashville and a few minutes from the Tennessee River.${priceLine}`,
    '',
    `${f.hook}`,
    '',
    `Power is at the road and high-speed internet is available, so you are not starting from nothing. There is a soil map, so you know where a septic can go before you buy, and the driveway is already graded in. It is unrestricted — no HOA, and no clock on when you have to build.`,
    '',
    `I am the owner, not an agent. Happy to answer questions in the comments, including the ones people usually find out too late — access, septic, what the county will let you do.`,
    '',
    `Photos and the survey are here: ${link}`,
  ].join('\n');
}

/** A short brief Tony can forward inside the United Country network. */
export function agentBrief(lot, link) {
  const f = lotFacts(lot);
  return [
    `Sugar Tree Vista — Lot ${f.num}, ${f.name}`,
    `${f.acreage} acres · ${f.county} County, TN${f.price ? ` · ${f.price}` : ''}`,
    '',
    `Ridgeline tract roughly 90 minutes south of Nashville, minutes from the Tennessee River at Kentucky Lake.`,
    `Power at the road, high-speed internet available, soil map in hand, graded driveway installed,`,
    `new survey and warranty deed. Unrestricted — no HOA, no build time limit.`,
    '',
    `Buyer profile: second home, hunting or recreational tract, or a build-when-ready homesite.`,
    `Nashville commuter ring, Jackson, and west Tennessee generally.`,
    '',
    `Full details and survey: ${link}`,
    `Seller: David A. Stone, Alot of Land LLC — (615) 538-6878`,
  ].join('\n');
}
