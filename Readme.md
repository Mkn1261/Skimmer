# Skimmer

Give it a website, it reads the site and then answers questions about it.

The point is that answers only come from pages it actually crawled. If something isn't on the site it says "not found in the site" rather than filling in the gap from what the model happens to know.

Built with React + Vite on the front, Node/Express on the back, Gemini for embeddings and generation, Pinecone for the vectors.

## How it works

Two flows.

**Indexing** runs once, when you paste a URL:

```
crawl internal pages (BFS, 5 at a time)
  -> strip nav/footer/scripts with cheerio
  -> split into ~500-1000 token chunks, 50 token overlap
  -> embed with gemini-embedding-001 (768 dims, RETRIEVAL_DOCUMENT)
  -> upsert into pinecone under a namespace = new session uuid
```

**Asking** runs per question:

```
regex check for greetings / "what can you do" -> canned reply, no api calls
  -> embed the question (RETRIEVAL_QUERY)
  -> top-k cosine search inside that session's namespace
  -> drop anything under the score threshold
  -> nothing left? return "not found in the site", never call the model
  -> otherwise build a prompt (chunks + last few turns + rules) and send to gemini-2.5-flash
```

That second-to-last step is the part I care most about. The model doesn't get a chance to make something up because it's never called without real page text in front of it. The prompt rules are a backup, not the main defence.

All the keys live on the backend. The frontend only knows two endpoints.

## Running it

You'll need Node 18+, a [Gemini API key](https://aistudio.google.com/), and a [Pinecone](https://www.pinecone.io/) index set to **dimension 768, metric cosine**. The dimension has to match or every upsert fails.

```bash
cd backend
npm install
# create .env first, see below
npm run dev        # :4000

cd frontend
cp .env.local.example .env.local
npm install
npm run dev        # :5173
```

Then open http://localhost:5173 and paste a URL.

`backend/.env`:

```
PORT=4000
PINECONE_API_KEY=
PINECONE_INDEX_NAME=
GEMINI_API_KEY=
ALLOWED_ORIGIN=          # comma separated, leave empty in dev to allow anything
```

`frontend/.env.local` just needs `VITE_APP_URL` pointing at the backend.

Both are gitignored. If you leak a key, rotate it.

## API

`POST /api/crawl/start`

```json
{ "url": "https://docs.example.com", "maxPages": 15 }
```

```json
{ "sessionId": "3f9c...", "pagesCrawled": 12, "chunksCreated": 87, "vectorsStored": 87 }
```

Hang on to the sessionId, every question needs it.

`POST /api/rag/ask`

```json
{
  "question": "What is the refund policy?",
  "sessionId": "3f9c...",
  "history": [{ "role": "user", "text": "..." }]
}
```

```json
{
  "answer": "...",
  "contextUsed": [{ "sourceUrl": "https://...", "title": "...", "score": 0.81, "preview": "..." }]
}
```

`history` is optional. It's the last few turns so follow-up questions like "what about the second one" have something to refer back to.

`GET /api/health` returns `{ "status": "ok" }`.

## Some decisions worth explaining

**BFS, not DFS.** There's a hard page cap, so the crawl budget should go on pages near the homepage rather than tunnelling six levels into a blog archive. Also worth noting: URLs get added to the visited set when they're queued, not when they're fetched, otherwise the same page ends up in the frontier twice.

**One namespace per session.** Rather than one index per crawl (expensive) or everything in one bucket (leaky), each crawl gets a namespace keyed by a fresh uuid. Queries are scoped to it, so two people crawling different sites can't see each other's content.

**Chunks and queries use the same embedding model.** Cosine similarity only means anything inside one vector space. The only difference is the taskType hint, RETRIEVAL_DOCUMENT vs RETRIEVAL_QUERY.

**Chunk IDs are `url#index`.** Deterministic, so re-crawling a site overwrites the old chunks instead of doubling them up.

**Overview questions get different settings.** "Summarize this site" is a vague query and scores badly against everything, so those questions widen to topK 12 with a 0.2 floor instead of 5 and 0.35. Coverage matters more than precision when someone asks for a summary.

**Conversation state lives in the browser.** The backend doesn't remember anything between requests. ChatPage sends the last six turns with each question, which also stops the prompt growing without bound in a long chat.

## Known limitations

Indexing happens synchronously inside one HTTP request, which is fine for 15 pages and not fine for a big site. The real fix is a job queue plus a status endpoint to poll, which I haven't done.

Other things missing: sessions don't survive a Pinecone cleanup or get deleted at all, there's no rate limiting, no reranking pass before generation, no streaming, and it doesn't check robots.txt.

## License

MIT
