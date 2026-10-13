import { Pinecone } from "@pinecone-database/pinecone";

let pineconeClient = null;
let index = null;

// cached between calls, a warm lambda reuses the same handle
export function getPineconeIndex() {
  if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_NAME) {
    throw new Error("PINECONE_API_KEY / PINECONE_INDEX_NAME missing from environment.");
  }

  if (!index) {
    pineconeClient = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    index = pineconeClient.index(process.env.PINECONE_INDEX_NAME);
    console.log(`[pinecone] Index handle ready: ${process.env.PINECONE_INDEX_NAME}`);
  }
  return index;
}