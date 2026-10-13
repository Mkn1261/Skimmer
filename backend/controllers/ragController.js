import { GoogleGenerativeAI } from "@google/generative-ai";
import { queryVectors } from "../db/queryVectors.js";

const TOP_K = 5;

// tuned by hand. below ~0.3 we started pulling in unrelated chunks,
// above 0.4 valid answers were getting rejected.
const MIN_SCORE = 0.35;

// "summarize this site" needs to see a lot more of the index, and the
// scores are naturally lower because the question is vague
const OVERVIEW_TOP_K = 12;
const OVERVIEW_MIN_SCORE = 0.2;

const HISTORY_TURNS = 6;

const SMALLTALK_RE =
  /^(hi|hii+|hey+|hello|yo|sup|thanks|thank you|thx|ty|ok|okay|k|cool|nice|great|awesome|got it|bye|goodbye|good (morning|afternoon|evening|night))[\s!.,?]*$/i;

const CAPABILITY_RE =
  /\b(who are you|what are you|what can you do|what do you do|how do you work|how does this work|what is this( app| tool| site)?\?*$|help me|how to use)\b/i;

const OVERVIEW_RE =
  /\b(summar(y|ise|ize)|overview|outline|tl;?dr|what(?:'s| is| are)? (?:this|the site|it) about|what (?:content|topics|pages|sections|info(?:rmation)?)|anything else|what else|other (?:thing|stuff|info)|tell me more|more (?:about|useful|details)|everything|all the content)\b/i;

// flash first, lite as a fallback when flash is overloaded
const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 800;

// lazy so a missing key fails on the request instead of at import time
let genAI = null;
function getModel(modelName) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY missing from environment.");
  }
  if (!genAI) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI.getGenerativeModel({ model: modelName });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// worth retrying (rate limit / capacity) vs our own fault (bad key, bad prompt).
// the sdk doesn't always give a status code so we fall back to sniffing the message.
function isTransient(err) {
  const status = err?.status ?? err?.response?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  return /\[(429|5\d\d)\b|overloaded|service unavailable|high demand/i.test(
    err?.message || ""
  );
}

async function generateWithRetry(prompt) {
  let lastErr;

  for (const modelName of MODELS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await getModel(modelName).generateContent(prompt);
        return result.response.text().trim();
      } catch (err) {
        lastErr = err;
        if (!isTransient(err) || attempt === MAX_ATTEMPTS) break;

        // exponential backoff + jitter so retries don't line up
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 250;
        console.warn(
          `[ragController] ${modelName} attempt ${attempt}/${MAX_ATTEMPTS} failed ` +
            `(${err.message.slice(0, 120)}), retrying in ${Math.round(delay)}ms`
        );
        await sleep(delay);
      }
    }

    // no point trying the next model if it wasn't a capacity problem
    if (!isTransient(lastErr)) break;
    console.warn(`[ragController] ${modelName} exhausted, falling back`);
  }

  throw lastErr;
}

function formatHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return "";

  const turns = history
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.text === "string" &&
        m.text.trim()
    )
    .slice(-HISTORY_TURNS)
    // truncate each turn, a long earlier answer can crowd out the actual context
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text.trim().slice(0, 500)}`)
    .join("\n");

  return turns ? `CONVERSATION SO FAR:\n${turns}\n\n` : "";
}

function buildPrompt(question, contextChunks, history, isOverview) {
  const contextBlock = contextChunks
    .map((c, i) => `[Source ${i + 1}] (${c.sourceUrl})\n${c.text}`)
    .join("\n\n---\n\n");

  const task = isOverview
    ? `The user wants an OVERVIEW. Pull together ALL the sources below into a short summary of what this site covers. If the site barely has any content, just say that and state what little is there. That is an honest answer, not a failure.`
    : `Answer the user's question from the context below.`;

  return `You are a website assistant. You are talking to a user about ONE website that was crawled for you. ${task}

STRICT RULES:
1. Every FACT must come from the context below. Never add outside knowledge, and never invent URLs, prices, dates, names, or features.
2. Summarizing, rephrasing, listing, grouping and explaining the context is ENCOURAGED. That is not outside knowledge. Do not just copy a sentence back verbatim.
3. Read CONVERSATION SO FAR. If you already gave this information, do NOT repeat it word-for-word. Either add something genuinely new from the context, or say directly that the site contains nothing further on this.
4. If the site's content is thin, say so (e.g. "That's basically all this site has, it's a one-page placeholder.") instead of restating the same line again.
5. If the context genuinely does not contain the answer, start your reply with "not found in the site", then optionally add one sentence on what the site DOES cover.
6. Write in a natural, conversational tone. Plain sentences, no markdown headings. Keep it short unless the user asked for detail.

${formatHistory(history)}CONTEXT:
${contextBlock}

QUESTION: ${question}

ANSWER:`;
}

export async function askQuestion(req, res) {
  const { question, sessionId, history } = req.body || {};

  if (!question || typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "Body must include a non-empty 'question'." });
  }
  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "Body must include 'sessionId' (from /api/crawl/start)." });
  }

  const q = question.trim();

  // catch these before we spend an embedding call + a gemini call on "hi"
  if (SMALLTALK_RE.test(q)) {
    return res.status(200).json({
      answer: "Hey! Ask me anything about the site you indexed and I'll answer from its content.",
      contextUsed: [],
    });
  }
  if (CAPABILITY_RE.test(q)) {
    return res.status(200).json({
      answer:
        "I answer questions about the website you indexed, using only text crawled from its pages. " +
        "Ask about anything on the site, or say \"summarize this site\" for an overview. " +
        "If something isn't on the site, I'll tell you rather than guess.",
      contextUsed: [],
    });
  }

  const isOverview = OVERVIEW_RE.test(q);
  const topK = isOverview ? OVERVIEW_TOP_K : TOP_K;
  const minScore = isOverview ? OVERVIEW_MIN_SCORE : MIN_SCORE;

  try {
    const matches = await queryVectors(q, sessionId, topK);
    const relevant = matches.filter((m) => m.score >= minScore && m.text);

    // nothing decent came back, so don't bother calling the model at all.
    // this is what stops it making things up when the site never mentioned it.
    if (relevant.length === 0) {
      return res.status(200).json({
        answer: "not found in the site",
        contextUsed: [],
      });
    }

    let answerText;
    try {
      answerText = await generateWithRetry(
        buildPrompt(q, relevant, history, isOverview)
      );
    } catch (err) {
      console.error("[ragController] generation failed:", err);

      if (isTransient(err)) {
        return res.status(503).json({
          error:
            "The model is busy right now. Your site is still indexed, try asking again in a few seconds.",
        });
      }
      throw new Error(`Gemini generation failed: ${err.message}`);
    }

    return res.status(200).json({
      answer: answerText,
      contextUsed: relevant.map((c) => ({
        sourceUrl: c.sourceUrl,
        title: c.title,
        score: Number(c.score.toFixed(4)),
        preview: c.text.slice(0, 200),
      })),
    });
  } catch (err) {
    console.error("[ragController]", err);

    // the question's own embedding comes out of the same quota the crawl spent
    if (err.status === 429) {
      return res.status(429).json({
        error: "Embedding quota exhausted. Your site is still indexed, try again in a minute.",
        detail: err.message,
      });
    }

    return res.status(500).json({ error: "RAG pipeline failed.", detail: err.message });
  }
}