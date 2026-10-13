import { useState } from "react";
import CrawlPage from "./pages/CrawlPage.jsx";
import ChatPage from "./pages/ChatPage.jsx";
import Navbar from "./components/Navbar.jsx";

// two screens and no deep linking to speak of, so react-router would be
// more setup than it's worth. session === null just means "not crawled yet".
export default function App() {
  const [session, setSession] = useState(null);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar onHome={() => setSession(null)} siteUrl={session?.siteUrl} />

      {session ? (
        <ChatPage
          sessionId={session.sessionId}
          siteUrl={session.siteUrl}
          onReset={() => setSession(null)}
        />
      ) : (
        <CrawlPage
          onReady={(sessionId, siteUrl) => setSession({ sessionId, siteUrl })}
        />
      )}
    </div>
  );
}
