#!/usr/bin/env node
/**
 * fetch-ground-outer.mjs — downloads the light "outer ring" of the map (major roads, water, big green areas, no buildings)
 * from Overpass in a 3x3 grid of small queries, writes data-raw/ground-outer-overpass.json (git-ignored) and the used
 * area to data-raw/ground-outer-bbox.json. build-ground-data.mjs merges it with the detailed inner extract.
 *   node scripts/fetch-ground-outer.mjs
 * Data (c) OpenStreetMap contributors, ODbL.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// south, west, north, east of the whole outer area (~8.2 x 7.4 km around the campus)
export const OUTER = [41.354, 2.0655, 41.4205, 2.164];
const N = 3;
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const query = (b) => `[out:json][timeout:120];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"](${b});
  way["natural"~"^(water|wood)$"](${b});
  way["landuse"~"^(forest|grass|recreation_ground|meadow|cemetery)$"](${b});
  way["leisure"~"^(park|garden)$"](${b});
);
out geom;`;

mkdirSync(join(ROOT, 'data-raw'), { recursive: true });
const [s, w, n, e] = OUTER;
const elements = new Map();
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    const b = [s + ((n - s) * i) / N, w + ((e - w) * j) / N, s + ((n - s) * (i + 1)) / N, w + ((e - w) * (j + 1)) / N].map((v) => v.toFixed(5)).join(',');
    for (let attempt = 1; ; attempt++) {
      const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'User-Agent': 'datathon-map-fetch/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query(b)) });
      if (r.ok) {
        const j2 = await r.json();
        for (const el of j2.elements) elements.set(`${el.type}${el.id}`, el);
        console.log(`tile ${i},${j}: ${j2.elements.length} elements (total ${elements.size})`);
        break;
      }
      console.warn(`tile ${i},${j} attempt ${attempt}: HTTP ${r.status}`);
      if (attempt >= 4) process.exit(1);
      await sleep(15000 * attempt);
    }
    await sleep(6000); // be polite to the public server
  }
}
writeFileSync(join(ROOT, 'data-raw/ground-outer-overpass.json'), JSON.stringify({ elements: [...elements.values()] }));
writeFileSync(join(ROOT, 'data-raw/ground-outer-bbox.json'), JSON.stringify({ south: s, west: w, north: n, east: e }));
console.log('done', elements.size);
