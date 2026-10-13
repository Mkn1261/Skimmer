// used for local dev only. vercel runs api/index.js instead.
import app from "./app.js";

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`RAG backend listening on http://localhost:${PORT}`);
});
