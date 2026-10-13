import { getPineconeIndex } from "./pinecone.js";

// pinecone rejects payloads over ~2MB, 100 vectors stays well under
const UPSERT_BATCH = 100;

export async function storeVectors(chunks, vectors, sessionId) {
  // if these ever drift we'd silently attach the wrong vector to a chunk,
  // which is a nightmare to debug later. fail loudly instead.
  if (chunks.length !== vectors.length) {
    throw new Error(
      `Chunk/vector count mismatch: ${chunks.length} chunks vs ${vectors.length} vectors.`
    );
  }

  const index = getPineconeIndex();
  const ns = index.namespace(sessionId);

  const records = chunks.map((chunk, i) => ({
    id: chunk.id,
    values: vectors[i],
    metadata: chunk.metadata,
  }));

  let stored = 0;
  for (let i = 0; i < records.length; i += UPSERT_BATCH) {
    const batch = records.slice(i, i + UPSERT_BATCH);
    try {
      await ns.upsert(batch);
      stored += batch.length;
    } catch (err) {
      throw new Error(`Pinecone upsert failed (batch @${i}): ${err.message}`);
    }
  }

  console.log(`[pinecone] Stored ${stored} vectors in namespace "${sessionId}"`);
  return stored;
}