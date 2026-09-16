import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const prerender = true;

const W = 1200, H = 630;

export async function getStaticPaths() {
  const listings = await getCollection('listings', l => l.data.visible !== false);
  return listings.map(l => ({ params: { slug: l.slug }, props: { listing: l } }));
}

// Load the listing's first photo — supports both local /images paths and
// remote (e.g. Cloudinary) URLs. Falls back to the hero image.
async function loadPhoto(src?: string): Promise<Buffer> {
  const hero = () => readFile(join(process.cwd(), 'public/images/hero-land.jpg'));
  if (!src) return hero();
  try {
    if (src.startsWith('http')) {
      const res = await fetch(src);
      if (!res.ok) return hero();
      return Buffer.from(await res.arrayBuffer());
    }
    return await readFile(join(process.cwd(), 'public', src.replace(/^\//, '')));
  } catch {
    return hero();
  }
}

export const GET: APIRoute = async ({ props }) => {
  const { listing } = props as { listing: any };
  const status: string = listing.data.status;

  const photoBuf = await loadPhoto(listing.data.photos?.[0]);
  const base = await sharp(photoBuf).resize(W, H, { fit: 'cover' }).toBuffer();

  // Composite the pre-rendered status stamp (baked text — no build-server fonts needed)
  let pipeline = sharp(base);
  try {
    const overlay = await readFile(join(process.cwd(), 'public/og-stamps', `${status}.png`));
    pipeline = pipeline.composite([{ input: overlay, top: 0, left: 0 }]);
  } catch {
    // unknown status → just the photo, no stamp
  }

  const out = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return new Response(out, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
