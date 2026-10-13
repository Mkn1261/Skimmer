export default function Navbar({ onHome, siteUrl }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
      <nav className="w-full px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <button
          onClick={onHome}
          title="Start over with a new link"
          className="flex items-center gap-2.5 rounded-lg px-2 py-1 -ml-2 transition-colors
                     hover:bg-accent-sm"
        >
          <span className="w-8 h-8 grid place-items-center rounded-md bg-accent text-white
                           font-display font-bold text-lg">
            S
          </span>
          <span className="font-display text-2xl font-bold text-ink">Skimmer</span>
        </button>

        {siteUrl && (
          <span className="text-sm text-muted truncate max-w-[45vw]">
            {siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </span>
        )}
      </nav>
    </header>
  );
}
