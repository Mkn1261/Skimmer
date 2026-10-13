import { embedQuery } from "../processing/embedder.js";
import { getPineconeIndex } from "./pinecone.js";

export async function queryVectors(question, sessionId, topK = 5) {
  const queryVector = await embedQuery(question);

  const index = getPineconeIndex();
  const ns = index.namespace(sessionId);

  let result;
  try {
    result = await ns.query({
      vector: queryVector,
      topK,
      includeMetadata: true,
      includeValues: false,
    });
  } catch (err) {
    throw new Error(`Pinecone query failed: ${err.message}`);
  }

  return (result.matches || []).map((m) => ({
    score: m.score,
    text: m.metadata?.text || "",
    sourceUrl: m.metadata?.sourceUrl || "",
    title: m.metadata?.title || "",
  }));
}