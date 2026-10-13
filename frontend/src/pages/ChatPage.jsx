import { useEffect, useRef, useState } from "react";
import { askQuestion, toErrorMessage } from "../services/api.js";
import Loader from "../components/Loader.jsx";
import MessageBubble from "../components/MessageBubble.jsx";

export default function ChatPage({ sessionId, siteUrl, onReset }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: `I've read through ${new URL(siteUrl).hostname}. Ask me anything about it. I'll only answer from what's actually on the site.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  // stick to the bottom as messages come in
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async () => {
    const question = input.trim();
    if (!question || loading) return;

    // build history off the current messages, before we append this one.
    // error bubbles get dropped, the model shouldn't see those.
    const history = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text }));

    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setLoading(true);

    try {
      const { answer, contextUsed } = await askQuestion(question, sessionId, history);
      setMessages((m) => [...m, { role: "assistant", text: answer, sources: contextUsed }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "error", text: toErrorMessage(err) }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex-1 flex flex-col w-full max-w-3xl mx-auto px-4 min-h-0">
      <div className="py-4 flex items-center justify-between gap-3 border-b border-line">
        <h1 className="font-display font-bold text-ink truncate">
          Chatting with {new URL(siteUrl).hostname}
        </h1>
        <button
          onClick={onReset}
          className="shrink-0 text-xs font-medium text-accent-hi border border-accent-hi/40
                     bg-accent-sm rounded-lg px-3 py-2 transition
                     hover:bg-accent hover:text-white hover:border-accent-hi"
        >
          New site
        </button>
      </div>

      <section className="flex-1 overflow-y-auto chat-scroll py-6 space-y-4">
        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} text={m.text} sources={m.sources} />
        ))}
        {loading && (
          <div className="pl-2">
            <Loader label="Looking through the site…" />
          </div>
        )}
        <div ref={bottomRef} />
      </section>

      <footer className="py-4 border-t border-line">
        <div className="flex gap-3">
          <input
            id="question"
            name="question"
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Ask about this website…"
            disabled={loading}
            className="flex-1 rounded-xl! px-4! py-3! text-base! disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="shrink-0 rounded-xl border border-accent-hi bg-accent px-5 py-3
                       font-display font-bold text-white shadow-sm transition
                       hover:bg-accent-hi active:scale-95
                       disabled:opacity-40 disabled:active:scale-100"
          >
            Send
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Answers come only from this website's pages.
        </p>
      </footer>
    </main>
  );
}
