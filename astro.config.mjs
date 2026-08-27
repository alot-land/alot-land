import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import remarkBreaks from 'remark-breaks';

export default defineConfig({
  site: 'https://alot.land',
  // Treat a single line break in Markdown (one Enter in the CMS) as a real line
  // break on the page, matching what editors see in the Decap preview.
  markdown: {
    remarkPlugins: [remarkBreaks],
  },
  integrations: [
    tailwind(),
    sitemap({
      // Utility/private/thin pages excluded from sitemap.
      // favorites = per-visitor localStorage page (nothing to index);
      // media = no press/podcast/book content yet, so it reads as thin content.
      filter: (page) =>
        !page.includes('/admin') &&
        !page.includes('/invest') &&
        !page.includes('/land-payment-calculator') &&
        !page.includes('/listings/favorites') &&
        !page.includes('/media') &&
        !page.includes('/seo') &&
        !page.includes('/handbook') &&
        !page.includes('/crm'),
    }),
  ],
});
