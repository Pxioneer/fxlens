import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODELS = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || 'gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash-lite').split(',').map(s => s.trim()).filter(Boolean);
// Vercel Hobby hard-caps function execution at 60s regardless of maxDuration. With 3
// models that leaves ~15s each if we want real headroom — so one attempt per model, no
// backoff sleep, and a hard per-call timeout so a single stalled model can't eat the
// whole budget and take the request down with it (that's what caused the 504s).
const MAX_RETRIES_PER_MODEL = 1;
const PER_CALL_TIMEOUT_MS = 15000;
// Vercel Functions hard-cap request bodies at 4.5MB at the infra level (413 before this
// code ever runs). The old 8MB check let bad uploads through that Vercel silently killed.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const prompt = (symbol, timeframe, notes) => `You are FXLens, a screenshot-based trading analysis assistant.
Market hint: ${symbol}. Timeframe hint: ${timeframe}. User note: ${notes || 'none'}.

Analyze ONLY evidence visible in the supplied chart screenshot. Do not claim live price, news, order flow, broker data, or certainty.
Identify the instrument and timeframe if readable. Evaluate:
- market structure (HH/HL/LH/LL)
- trend and momentum
- visible support/resistance
- candlestick behavior
- chart patterns
- visible indicators and their signals

Decision rules:
- BUY only when the visible evidence is coherently bullish.
- SELL only when the visible evidence is coherently bearish.
- WAIT when evidence conflicts, the setup is incomplete, or the screenshot is too small/blurred to support a directional call.
- Never force BUY or SELL.

Entry, stop loss and take profit must be approximate screenshot-derived levels. If the price scale is unreadable, return "Not readable" rather than inventing a price.
Confidence reflects the quality and agreement of the visible evidence, NOT probability of profit. Keep confidence at or below 60 when important information is missing or unclear.
Setup quality must be Strong, Moderate, Weak, or Unclear.
Risk/reward should be approximate if levels are readable; otherwise return "Not readable".
Keep reasons and risks concise.

Return ONLY valid JSON with exactly these fields:
{
  "action": "BUY" | "SELL" | "WAIT",
  "confidence": number,
  "instrument": string,
  "timeframe": string,
  "summary": string,
  "entry": string,
  "stop_loss": string,
  "take_profit": string,
  "setup_quality": "Strong" | "Moderate" | "Weak" | "Unclear",
  "risk_reward": string,
  "reasons": string[],
  "risks": string[]
}

This is educational market analysis, not guaranteed financial advice.`;

function cleanJson(text) {
  const value = String(text || '').trim();
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : value;
}

export async function POST(req) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'FXLens is not connected to Gemini yet. Add GEMINI_API_KEY in Vercel Environment Variables.' },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const img = form.get('image');
    const symbol = String(form.get('symbol') || 'Auto');
    const timeframe = String(form.get('timeframe') || 'Auto');
    const notes = String(form.get('notes') || '');

    if (!img || typeof img === 'string') {
      return NextResponse.json({ error: 'No chart image uploaded.' }, { status: 400 });
    }
    if (img.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'Image is larger than 4MB.' }, { status: 400 });
    }
    if (!img.type?.startsWith('image/')) {
      return NextResponse.json({ error: 'Unsupported image type.' }, { status: 400 });
    }

    const bytes = Buffer.from(await img.arrayBuffer());
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Gemini structured output: this prevents the model from returning prose/markdown
    // when FXLens expects JSON. See Google's current GenerateContent structured-output docs.
    const responseSchema = {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['BUY', 'SELL', 'WAIT'] },
        confidence: { type: 'number' },
        instrument: { type: 'string' },
        timeframe: { type: 'string' },
        summary: { type: 'string' },
        entry: { type: 'string' },
        stop_loss: { type: 'string' },
        take_profit: { type: 'string' },
        setup_quality: { type: 'string', enum: ['Strong', 'Moderate', 'Weak', 'Unclear'] },
        risk_reward: { type: 'string' },
        reasons: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } }
      },
      required: [
        'action', 'confidence', 'instrument', 'timeframe', 'summary',
        'entry', 'stop_loss', 'take_profit', 'setup_quality',
        'risk_reward', 'reasons', 'risks'
      ]
    };

    const contents = [{
      role: 'user',
      parts: [
        { text: prompt(symbol, timeframe, notes) },
        { inlineData: { mimeType: img.type, data: bytes.toString('base64') } }
      ]
    }];

    const config = {
      responseMimeType: 'application/json',
      responseSchema,
      maxOutputTokens: 3072,
      // Gemini 3.x flash models think by default, and thinking tokens are drawn from the
      // SAME maxOutputTokens budget as the visible reply (not a separate allowance). With
      // this unset, the model can spend the whole budget "thinking" and return an empty or
      // truncated response — an intermittent failure that looks random from the outside.
      // This is a fixed, well-defined image-read task, so thinking buys nothing here.
      thinkingConfig: { thinkingBudget: 0 }
    };

    // Gemini can temporarily return 503/429 during congestion, and gemini-3.7-flash has a
    // known decode-loop regression on schema-constrained JSON that burns the token budget
    // and returns truncated/unparseable JSON. Both cases fall through to the next model,
    // not just network-level errors.
    let parsed = null;
    let lastError = null;
    let usedModel = null;

    outer: for (const model of MODELS) {
      for (let attempt = 0; attempt < MAX_RETRIES_PER_MODEL; attempt++) {
        try {
          const response = await Promise.race([
            ai.models.generateContent({ model, contents, config }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Model call timed out.')), PER_CALL_TIMEOUT_MS))
          ]);
          const raw = response?.text;
          if (!raw) throw new Error('Empty response from model.');
          parsed = JSON.parse(cleanJson(raw));
          usedModel = model;
          break outer;
        } catch (err) {
          lastError = err;
          // Every branch here just moves to the next model — no sleeping. Retrying the
          // SAME model with a backoff delay is what pushed total request time past
          // Vercel's 60s ceiling and caused the 504s.
        }
      }
    }

    if (!parsed) {
      const message = String(lastError?.message || 'All configured Gemini models returned an unreadable response.');
      return NextResponse.json(
        { error: `Gemini is temporarily unavailable or returned bad output. FXLens tried ${MODELS.length} model(s). Please try again shortly.`, detail: message.slice(0, 500) },
        { status: 503 }
      );
    }

    const allowedActions = ['BUY', 'SELL', 'WAIT'];
    const allowedQuality = ['Strong', 'Moderate', 'Weak', 'Unclear'];

    if (!allowedActions.includes(parsed.action)) parsed.action = 'WAIT';
    parsed.confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0));
    if (!allowedQuality.includes(parsed.setup_quality)) parsed.setup_quality = 'Unclear';
    parsed.reasons = Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 5) : ['Insufficient visible evidence.'];
    parsed.risks = Array.isArray(parsed.risks) ? parsed.risks.slice(0, 5) : ['Screenshot-only analysis can miss market information.'];

    parsed.model_used = usedModel;
    return NextResponse.json(parsed);
  } catch (error) {
    console.error('FXLens Gemini error:', error);
    const message = error?.message || 'Gemini analysis failed. Try another screenshot.';
    return NextResponse.json(
      { error: `Gemini error: ${message}` },
      { status: 502 }
    );
  }
}
