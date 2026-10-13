import { useState } from "react";
import { startCrawl, toErrorMessage } from "../services/api.js";
import Loader from "../components/Loader.jsx";

export default function CrawlPage({ onReady }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);

  const handleCrawl = async () => {
    setError("");
    // nobody types "https://". strip whatever they did type and put it back on.
    const typed = url.trim().replace(/^https?:\/\//i, "");
    if (!/^[^\s.]+\.[^\s]+/.test(typed)) {
      setError("That doesn't look like a website link. Try example.com");
      return;
    }
    const target = `https://${typed}`;

    setLoading(true);
    try {
      const data = await startCrawl(target);
      setSummary(data);
      // let them see the "ready" message before we swap the page out
      setTimeout(() => onReady(data.sessionId, target), 1400);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-sm">
        <h1 className="font-display text-4xl md:text-5xl font-bold text-ink leading-tight">
          Know any site in{" "}
          <span className="text-accent underline decoration-accent decoration-2 underline-offset-8">
            minutes
          </span>
        </h1>
        <p className="mt-4 text-muted">
          Paste a link and Skimmer reads the whole website for you. Then just ask
          questions. Every answer comes straight from that site.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <input
            id="site-url"
            name="site-url"
            type="url"
            autoComplete="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && handleCrawl()}
            placeholder="example.com/docs"
            disabled={loading}
            className="flex-1 rounded-xl! px-4! py-3! text-base! disabled:opacity-50"
          />
          <button
            onClick={handleCrawl}
            disabled={loading}
            className="shrink-0 rounded-xl border border-accent-hi bg-accent px-6 py-3
                       font-display font-bold text-white shadow-sm transition
                       hover:bg-accent-hi active:scale-95
                       disabled:opacity-50 disabled:active:scale-100"
          >
            {loading ? "Reading…" : "Read site"}
          </button>
        </div>

        <div className="mt-6 min-h-20">
          {loading && <Loader label="Reading the site, this can take a minute…" />}

          {error && (
            <p className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {summary && (
            <div className="bg-accent-sm border border-line rounded-xl px-4 py-3 text-sm">
              <p className="font-bold text-success">✓ Ready</p>
              <p className="mt-1 text-muted">
                Read {summary.pagesCrawled}{" "}
                {summary.pagesCrawled === 1 ? "page" : "pages"}. Opening your chat…
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
