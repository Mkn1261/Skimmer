export default function MessageBubble({ role, text, sources }) {
  const isUser = role === "user";
  const isError = role === "error";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed border shadow-sm
          ${
            isUser
              ? "bg-accent text-white border-accent-hi rounded-br-sm"
              : isError
              ? "bg-danger/10 border-danger/30 text-danger"
              : "bg-surface border-line text-ink rounded-bl-sm"
          }`}
      >
        <p className="whitespace-pre-wrap">{text}</p>

        {sources?.length > 0 && (
          <div className="mt-3 pt-2 border-t border-line">
            <p className="text-[11px] font-medium text-muted mb-1">Read this on</p>
            {sources.map((s, i) => (
              <a
                key={i}
                href={s.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="block text-xs text-accent-hi hover:underline truncate"
                title={s.sourceUrl}
              >
                {s.sourceUrl.replace(/^https?:\/\//, "")}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
