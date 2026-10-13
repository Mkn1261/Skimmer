import axios from "axios";

const MODEL = "gemini-embedding-001";
// must match the pinecone index dimension or every upsert 400s
const DIMS = 768;
const BATCH_SIZE = 100;
const BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}`;

// the free tier bills one request per *chunk*, not per batch call, so a wide
// crawl can walk straight into the 100/min quota. retry, but stay inside
// vercel's 60s window - waiting out a 40s quota reset just times out instead.
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 20_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function apiKey() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY missing from environment.");
  }
  return process.env.GEMINI_API_KEY;
}

// gemini doesn't return unit vectors when you ask for a reduced dimensionality
function normalize(vec) {
  const magnitude = Math.hypot(...vec);
  return magnitude === 0 ? vec : vec.map((v) => v / magnitude);
}

function buildRequest(text, taskType) {
  return {
    model: `models/${MODEL}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: DIMS,
  };
}

function toMessage(err) {
  return err.response?.data?.error?.message || err.message;
}

function statusOf(err) {
  return err.response?.status ?? null;
}

// google tells us exactly how long the quota window has left, in a RetryInfo
// detail and again in prose at the end of the message. prefer the structured
// one, fall back to the prose, because only one of the two is always present.
function retryAfterMs(err) {
  const details = err.response?.data?.error?.details || [];
  const info = details.find((d) => typeof d?.retryDelay === "string");
  if (info) {
    const seconds = parseFloat(info.retryDelay);
    if (Number.isFinite(seconds)) return Math.ceil(seconds * 1000);
  }

  const match = /retry in ([\d.]+)\s*s/i.exec(toMessage(err) || "");
  return match ? Math.ceil(parseFloat(match[1]) * 1000) : null;
}

function isRetryable(err) {
  const status = statusOf(err);
  return status === 429 || (status !== null && status >= 500);
}

// carries the upstream status so the controller can answer 429 instead of
// flattening a quota problem into a generic 500 the user can't act on
function embedError(message, err) {
  const wrapped = new Error(message);
  wrapped.status = statusOf(err) ?? 500;
  return wrapped;
}

async function postWithRetry(url, body, timeout) {
  let lastErr;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await axios.post(url, body, {
        headers: { "Content-Type": "application/json" },
        timeout,
      });
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_RETRIES) break;

      const wait = Math.min(retryAfterMs(err) ?? 1000 * 2 ** attempt, MAX_RETRY_WAIT_MS);
      console.warn(
        `[embedder] ${statusOf(err)} from gemini, retry ${attempt + 1}/${MAX_RETRIES} in ${wait}ms`
      );
      await sleep(wait);
    }
  }

  throw lastErr;
}

export async function embedTexts(texts) {
  if (!texts.length) return [];

  const key = apiKey();
  const allVectors = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    try {
      const res = await postWithRetry(
        `${BASE}:batchEmbedContents?key=${key}`,
        { requests: batch.map((t) => buildRequest(t, "RETRIEVAL_DOCUMENT")) },
        60_000
      );

      allVectors.push(...res.data.embeddings.map((e) => normalize(e.values)));
    } catch (err) {
      throw embedError(
        `Gemini embedding request failed (batch @${i}): ${toMessage(err)}`,
        err
      );
    }
  }

  return allVectors;
}

// note the taskType here is RETRIEVAL_QUERY, not RETRIEVAL_DOCUMENT.
// same model either way, gemini just leans the vector differently.
export async function embedQuery(query) {
  const key = apiKey();

  try {
    const res = await postWithRetry(
      `${BASE}:embedContent?key=${key}`,
      buildRequest(query, "RETRIEVAL_QUERY"),
      30_000
    );

    const vector = res.data.embedding?.values;
    if (!vector) throw new Error("response contained no embedding values.");
    return normalize(vector);
  } catch (err) {
    throw embedError(`Gemini query embedding failed: ${toMessage(err)}`, err);
  }
}