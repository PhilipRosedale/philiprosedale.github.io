/**
 * Fetches Substack and Medium RSS feeds, merges by date, writes writings.json.
 * Run from repo root: node scripts/update-writings.js
 */
import Parser from 'rss-parser';

const SUBSTACK_FEED = 'https://philiprosedale.substack.com/feed';
const MEDIUM_FEED = 'https://medium.com/feed/@philiprosedale';
const OUT_PATH = new URL('../writings.json', import.meta.url).pathname;

const parser = new Parser();

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

async function main() {
  const entries = [];

  for (const [url, source] of [
    [SUBSTACK_FEED, 'substack'],
    [MEDIUM_FEED, 'medium'],
  ]) {
    try {
      const feed = await parser.parseURL(url);
      for (const item of feed.items || []) {
        const date = item.isoDate || item.pubDate || '';
        entries.push({
          title: item.title || 'Untitled',
          url: item.link || '',
          date,
          description: item.contentSnippet || stripHtml(item.content) || '',
          source,
        });
      }
    } catch (err) {
      console.error(`Failed to fetch ${source}:`, err.message);
    }
  }

  entries.sort((a, b) => new Date(b.date) - new Date(a.date));

  const json = JSON.stringify(entries, null, 2);
  await import('fs').then((fs) => fs.promises.writeFile(OUT_PATH, json, 'utf8'));
  console.log(`Wrote ${entries.length} entries to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
