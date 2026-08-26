import { defineCollection, z } from 'astro:content';

const listings = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    status: z.enum(['available', 'sold', 'coming-soon', 'under-contract']),
    featured: z.boolean().default(false),
    state: z.enum(['Arizona', 'Tennessee']),
    county: z.string(),
    acreage: z.string(),
    price: z.string().optional(),
    address: z.string().optional(),
    showAddress: z.boolean().optional().default(true),
    zoning: z.string().optional(),
    roadAccess: z.string().optional(),
    water: z.string().optional(),
    power: z.string().optional(),
    gps: z.string().optional(),
    videoUrl: z.string().optional(),
    showVideo: z.boolean().default(true),
    zillowUrl: z.string().optional(),
    showZillow: z.boolean().default(false),
    showSellerFinance: z.boolean().default(false),
    photos: z.array(z.string()).default([]),
    amenityPhotos: z.array(z.object({
      image: z.string(),
      caption: z.string(),
      category: z.string().optional(),
    })).optional().default([]),
    dateSold: z.coerce.date().optional(),
    showDaysOnMarket: z.boolean().default(false),
    buyerTestimonial: z.string().optional(),
    buyerName: z.string().optional(),
    community: z.string().optional(),
    date: z.coerce.date(),
  }),
});

const testimonials = defineCollection({
  type: 'content',
  schema: z.object({
    name: z.string(),
    location: z.string().optional(),
    role: z.string().optional(),
    featured: z.boolean().default(true),
    order: z.number().default(99),
    date: z.coerce.date(),
  }),
});

const communities = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    location: z.string().optional(),
    state: z.enum(['Arizona', 'Tennessee']).optional(),
    status: z.enum(['coming-soon', 'lots-available', 'sold-out']),
    image: z.string().optional(),
    ctaLabel: z.string().optional(),
    ctaUrl: z.string().optional(),
    videoUrl: z.string().optional(),
    showVideo: z.boolean().default(true),
    amenityPhotos: z.array(z.object({
      image: z.string(),
      caption: z.string(),
      category: z.string().optional(),
    })).optional().default([]),
    date: z.coerce.date(),
  }),
});

const press = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    publication: z.string().optional(),
    date: z.coerce.date(),
    excerpt: z.string().optional(),
    externalUrl: z.string().optional(),
    pdf: z.string().optional(),
    featured: z.boolean().default(false),
  }),
});

const podcasts = defineCollection({
  type: 'content',
  schema: z.object({
    showName: z.string(),
    episodeTitle: z.string(),
    date: z.coerce.date(),
    description: z.string().optional(),
    coverImage: z.string().optional(),
    listenUrl: z.string(),
    featured: z.boolean().default(false),
  }),
});

const books = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    coverImage: z.string().optional(),
    description: z.string().optional(),
    amazonPaperbackUrl: z.string().optional(),
    amazonKindleUrl: z.string().optional(),
    publishedDate: z.coerce.date().optional(),
    featured: z.boolean().default(false),
  }),
});

const ebooks = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    coverImage: z.string().optional(),
    description: z.string().optional(),
    audience: z.enum(['buyers', 'investors', 'sellers', 'both']).default('both'),
    featured: z.boolean().default(true),
  }),
});

const faqs = defineCollection({
  type: 'content',
  schema: z.object({
    question: z.string(),
    category: z.enum(['buying', 'selling', 'general']),
    // David answers the question on camera; the clip plays inside the accordion
    // and emits VideoObject schema so the answer is attributable to a person.
    videoUrl: z.string().optional(),
    videoDate: z.coerce.date().optional(),
    order: z.number().default(99),
    active: z.boolean().default(true),
  }),
});

// CMS-editable site settings (src/content/settings/*.json)
const settings = defineCollection({
  type: 'data',
  schema: z.object({
    // contact.json
    phone: z.string().optional(),
    phoneRaw: z.string().optional(),
    email: z.string().optional(),
    showInvestCta: z.boolean().optional().default(true),
    // homepage.json
    homepageVideoId: z.string().optional(),
    heroTagline: z.string().optional(),
    // videos.json
    featuredVideoUrl: z.string().optional(),
    featuredVideoNote: z.string().optional(),
    // sugar-tree.json
    saleDate: z.string().optional(),
    heroVideoUrl: z.string().optional(),
    showHeroVideo: z.boolean().optional().default(true),
    showingCalendarUrl: z.string().optional(),
    consultCalendarUrl: z.string().optional(),
    areaGuideFormUrl: z.string().optional(),
    heroImage: z.string().optional(),
    guidePhoto: z.string().optional(),
    developerPhoto: z.string().optional(),
    ogImage: z.string().optional(),
    galleryPhotos: z.array(z.string()).optional().default([]),
    // sugar-tree.json → sections: per-section show/hide + editable copy.
    // Every field is optional so the page falls back to its built-in default
    // and a missing/partial CMS entry can never break the build.
    // Drag-to-reorder list of section keys (CMS "Section Order").
    sectionOrder: z.array(z.string()).optional().default([]),
    sections: z.record(z.string(), z.union([z.object({
      show: z.boolean().optional(),
      order: z.number().optional(),
      showCountdown: z.boolean().optional(),
      showPhone: z.boolean().optional(),
      email: z.string().optional(),
      linkText: z.string().optional(),
      linkUrl: z.string().optional(),
      linkUrlCustom: z.string().optional(),
      eyebrow: z.string().optional(),
      heading: z.string().optional(),
      sub: z.string().optional(),
      body: z.string().optional(),
      note: z.string().optional(),
      footnote: z.string().optional(),
      tagline: z.string().optional(),
      name: z.string().optional(),
      button: z.string().optional(),
      buttonUrl: z.string().optional(),
      buttonUrlCustom: z.string().optional(),
      ctaPrimaryUrlCustom: z.string().optional(),
      ctaSecondaryUrlCustom: z.string().optional(),
      calcButtonUrlCustom: z.string().optional(),
      callButtonUrlCustom: z.string().optional(),
      ctaPrimaryUrl: z.string().optional(),
      ctaSecondaryUrl: z.string().optional(),
      calcButtonUrl: z.string().optional(),
      callButtonUrl: z.string().optional(),
      ctaPrimary: z.string().optional(),
      ctaSecondary: z.string().optional(),
      calcButton: z.string().optional(),
      callButton: z.string().optional(),
      promoPill: z.string().optional(),
      perkLine: z.string().optional(),
      placeholder: z.string().optional(),
      terms: z.string().optional(),
      quote: z.string().optional(),
      quoteCite: z.string().optional(),
      showingHeading: z.string().optional(),
      showingBody: z.string().optional(),
      showingButton: z.string().optional(),
      consultHeading: z.string().optional(),
      consultBody: z.string().optional(),
      consultButton: z.string().optional(),
      points: z.array(z.string()).optional(),
      perks: z.array(z.string()).optional(),
      badges: z.array(z.string()).optional(),
      stats: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
      drives: z.array(z.object({ time: z.string(), place: z.string() })).optional(),
      steps: z.array(z.object({ label: z.string(), heading: z.string(), body: z.string() })).optional(),
      rows: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    }), z.any()])).optional().default({}),
  }),
});

const team = defineCollection({
  type: 'content',  // body = bio
  schema: z.object({
    name:   z.string(),
    role:   z.string(),
    photo:  z.string().optional(),
    order:  z.number().default(99),
    active: z.boolean().default(true),
  }),
});

const vendors = defineCollection({
  type: 'content',  // body = short description
  schema: z.object({
    name:        z.string(),
    category:    z.enum(['excavation-septic', 'builders', 'lenders']),
    state:       z.enum(['Arizona', 'Tennessee', 'Both']),
    logo:        z.string().optional(),
    serviceArea: z.string().optional(),
    phone:       z.string().optional(),
    website:     z.string().optional(),
    active:      z.boolean().default(true),
    order:       z.number().default(99),
  }),
});

export const collections = { listings, testimonials, communities, press, podcasts, books, ebooks, faqs, settings, team, vendors };
