# FXLens Gemini v3.0.7

Mobile-first screenshot chart analyzer for MT5/TradingView screenshots.

## What changed in v3.0.3
- Replaced OpenAI with the Google Gemini API.
- Uses `@google/genai` on the server only; the API key is never exposed to the browser.
- Sends the uploaded chart image directly to Gemini for multimodal analysis.
- Uses `GEMINI_API_KEY` as the deployment secret.
- Uses `GEMINI_MODEL` with `gemini-3.7-flash` by default.
- Preserves BUY / SELL / WAIT, confidence, entry, stop loss, take profit, reasons, risks and local history.
- Uses Gemini structured JSON output with an explicit schema.
- Returns clean, readable API errors instead of leaking raw/non-JSON responses to the browser.

## Deploy on Railway from your phone

1. Upload this project to GitHub.
2. Railway → New Project → Deploy from GitHub repo → select it.
3. In the project's **Variables** tab, add:
   - `GEMINI_API_KEY` — your Gemini API key
   - `GEMINI_MODELS` (optional) — comma-separated fallback order
4. Settings → Networking → Generate Domain to get a public URL.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
