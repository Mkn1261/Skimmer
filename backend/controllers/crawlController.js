import { v4 as uuidv4 } from "uuid";
import { crawlWebsite } from "../crawler/crawler.js";
import { chunkPages, capChunks } from "../processing/chunker.js";
import { embedTexts } from "../processing/embedder.js";
import { storeVectors } from "../db/storeVectors.js";

export async function startCrawl(req, res) {
  const { url, maxPages } = req.body || {};

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Body must include a 'url' string." });
  }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    return res.status(400).json({ error: `Invalid URL: ${url}` });
  }

  // one namespace per crawl. keeps two users' sites from mixing.
  // TODO: nothing cleans these up yet, they just sit in the index
  const sessionId = uuidv4();

  try {
    // hard cap regardless of what the client asks for, otherwise someone
    // points this at wikipedia and the function times out
    const pages = await crawlWebsite(url, Math.min(maxPages || 15, 40));

    const allChunks = chunkPages(pages);
    if (allChunks.length === 0) {
      return res.status(422).json({ error: "Site produced no usable text chunks." });
    }

    // stay inside the embedding quota, see capChunks
    const chunks = capChunks(allChunks, Number(process.env.EMBED_CHUNK_BUDGET) || undefined);
    if (chunks.length < allChunks.length) {
      console.log(
        `[crawlController] Trimmed ${allChunks.length} chunks to ${chunks.length} for the embedding budget`
      );
    }

    const vectors = await embedTexts(chunks.map((c) => c.text));

    const vectorsStored = await storeVectors(chunks, vectors, sessionId);

    return res.status(200).json({
      sessionId,
      pagesCrawled: pages.length,
      chunksCreated: chunks.length,
      chunksSkipped: allChunks.length - chunks.length,
      vectorsStored,
    });
  } catch (err) {
    console.error("[crawlController]", err);

    // a blown quota is temporary and the user can act on it, so don't bury
    // it in the same 500 we use for real breakage
    if (err.status === 429) {
      return res.status(429).json({
        error: "Embedding quota exhausted. Wait a minute and try again.",
        detail: err.message,
      });
    }

    return res.status(500).json({
      error: "Crawl pipeline failed.",
      detail: err.message,
    });
  }
}