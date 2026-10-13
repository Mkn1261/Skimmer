import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_APP_URL || "http://localhost:4000",
  // crawling 15 pages + embedding them is slow, the default 0 timeout
  // would leave the tab hanging forever if the backend died
  timeout: 180_000,
  headers: { "Content-Type": "application/json" },
});

export async function startCrawl(url, maxPages = 15) {
  const { data } = await api.post("/api/crawl/start", { url, maxPages });
  return data;
}

export async function askQuestion(question, sessionId, history = []) {
  const { data } = await api.post("/api/rag/ask", { question, sessionId, history });
  return data;
}

// "RAG pipeline failed" means nothing to a user. log the real error,
// hand back something that tells them what to actually do.
export function toErrorMessage(err) {
  if (import.meta.env.DEV) console.error(err);

  const status = err?.response?.status;

  if (err?.code === "ECONNABORTED") {
    return "That site is taking too long to read. Try a single page instead of the whole site.";
  }
  if (!err?.response) {
    return "Can't reach Skimmer right now. Check your connection and try again.";
  }
  if (status === 422) {
    return "There wasn't enough readable text on that site. Try a different link.";
  }
  if (status === 400) {
    return "That link doesn't look right. Double-check it and try again.";
  }
  if (status === 429) {
    return "Skimmer has hit its reading limit for the minute. Wait about a minute and try again.";
  }
  if (status === 503) {
    return err?.response?.data?.error || "Skimmer is busy right now. Try again in a few seconds.";
  }
  return "Something went wrong on our end. Please try again in a moment.";
}