const CHARS_PER_TOKEN = 4;

export function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function chunkText(page, { minTokens = 500, maxTokens = 1000, overlapTokens = 50 } = {}) {
  const { url, title, text } = page;

  // split on sentence ends so a chunk never starts halfway through a thought.
  // the second branch catches trailing text with no final punctuation.
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [text];

  const chunks = [];
  let current = "";
  let chunkIndex = 0;

  const pushChunk = (body) => {
    const clean = body.trim();
    if (!clean) return;
    chunks.push({
      // same id every time we crawl this page, so a re-crawl overwrites
      // instead of piling up duplicates
      id: `${encodeURIComponent(url)}#${chunkIndex}`,
      text: clean,
      metadata: {
        sourceUrl: url,
        chunkIndex,
        title,
        // pinecone caps metadata size, so keep a trimmed copy for display
        text: clean.slice(0, 3000),
      },
    });
    chunkIndex++;
  };

  for (const sentence of sentences) {
    const candidate = current + sentence;

    if (estimateTokens(candidate) > maxTokens && estimateTokens(current) >= minTokens / 2) {
      pushChunk(current);

      // carry the tail over into the next chunk. without this, an answer that
      // straddles the boundary gets split and neither half scores well.
      const overlapChars = overlapTokens * CHARS_PER_TOKEN;
      current = current.slice(-overlapChars) + sentence;
    } else {
      current = candidate;
    }
  }
  pushChunk(current);

  return chunks;
}

export function chunkPages(pages, options) {
  return pages.flatMap((page) => chunkText(page, options));
}

// gemini's free tier counts one embedding request per chunk and allows 100 a
// minute, so a content-heavy crawl (wikipedia comes out around 140 chunks)
// 429s the entire pipeline. cap it, and keep headroom for the query
// embeddings the chat then spends out of the same quota window.
const DEFAULT_CHUNK_BUDGET = 90;

export function capChunks(chunks, budget = DEFAULT_CHUNK_BUDGET) {
  if (chunks.length <= budget) return chunks;

  const byPage = new Map();
  for (const chunk of chunks) {
    const key = chunk.metadata.sourceUrl;
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key).push(chunk);
  }

  // round robin across pages rather than slicing the front off the list.
  // a plain slice would spend the whole budget on the first few pages and
  // leave the rest of the site unindexed. this also favours low chunk
  // indexes, which is where a page's lead/intro text lives.
  const lanes = [...byPage.values()];
  const kept = [];

  for (let round = 0; kept.length < budget; round++) {
    let placedAny = false;

    for (const lane of lanes) {
      if (round >= lane.length) continue;
      kept.push(lane[round]);
      placedAny = true;
      if (kept.length === budget) break;
    }

    if (!placedAny) break;
  }

  return kept;
}