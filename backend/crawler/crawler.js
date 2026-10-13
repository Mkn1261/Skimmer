import axios from "axios";
import * as cheerio from "cheerio";

// drop the #hash and the trailing slash, otherwise /about, /about/ and
// /about#team all end up as three separate pages in the queue
function normalizeUrl(rawUrl, baseUrl) {
  try {
    const u = new URL(rawUrl, baseUrl);
    u.hash = "";
    let href = u.href;
    if (href.endsWith("/")) href = href.slice(0, -1);
    return href;
  } catch {
    return null;
  }
}

function isInternal(url, seedHost) {
  try {
    return new URL(url).host === seedHost;
  } catch {
    return false;
  }
}

const SKIP_EXTENSIONS =
  /\.(png|jpe?g|gif|svg|webp|ico|css|js|json|xml|pdf|zip|rar|mp4|mp3|woff2?|ttf|eot)$/i;

async function fetchPage(url) {
  try {
    const res = await axios.get(url, {
      timeout: 10_000,
      maxContentLength: 5 * 1024 * 1024,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SkimmerBot/1.0; +educational-rag-project)",
      },
      validateStatus: (s) => s >= 200 && s < 300,
    });

    const contentType = res.headers["content-type"] || "";
    if (!contentType.includes("text/html")) return null;

    const $ = cheerio.load(res.data);

    // kill the chrome first. nav/footer text repeats on every page and just
    // pollutes the embeddings with the same menu items over and over
    $("script, style, noscript, iframe, svg, nav, footer, header, aside").remove();
    $('[class*="cookie"], [class*="banner"], [id*="ad-"], [class*="advert"]').remove();

    const title = $("title").text().trim() || url;

    // prefer <main>/<article> if the site bothers with semantic html
    const root = $("main").length ? $("main") : $("article").length ? $("article") : $("body");

    const text = root.text().replace(/\s+/g, " ").trim();

    const links = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href) links.push(href);
    });

    return { url, title, text, links };
  } catch (err) {
    console.warn(`[crawler] Failed to fetch ${url}: ${err.message}`);
    return null;
  }
}

// fetching one page at a time blew past vercel's 60s limit on bigger sites.
// 5 is fine, going higher started getting us rate limited.
const CONCURRENCY = 5;

export async function crawlWebsite(seedUrl, maxPages = 20) {
  const seed = normalizeUrl(seedUrl, seedUrl);
  if (!seed) throw new Error(`Invalid seed URL: ${seedUrl}`);

  const seedHost = new URL(seed).host;

  const queue = [seed];
  const visited = new Set([seed]);
  const pages = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const batch = queue.splice(0, CONCURRENCY);
    const fetched = await Promise.all(batch.map(fetchPage));

    for (const page of fetched) {
      if (!page) continue;
      if (pages.length >= maxPages) break;

      // skip near empty pages, they're usually redirects or image galleries
      if (page.text.length > 100) {
        pages.push({ url: page.url, title: page.title, text: page.text });
        console.log(`[crawler] (${pages.length}/${maxPages}) ${page.url}`);
      }

      for (const raw of page.links) {
        const link = normalizeUrl(raw, page.url);
        if (!link) continue;
        if (!link.startsWith("http")) continue;
        if (!isInternal(link, seedHost)) continue;
        if (SKIP_EXTENSIONS.test(link)) continue;
        if (visited.has(link)) continue;

        // mark on enqueue, not on fetch, or the same url gets queued twice
        visited.add(link);
        queue.push(link);
      }
    }
  }

  if (pages.length === 0) {
    throw new Error("Crawler could not extract any content from the site.");
  }
  return pages;
}