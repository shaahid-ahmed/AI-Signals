/**
 * config.js
 * ─────────────────────────────────────────────────────────────
 * API key is injected at build time from the VITE_GEMINI_API_KEY
 * environment variable.
 *
 * Local dev:   add VITE_GEMINI_API_KEY=your_key to .env.local
 * Vercel:      add VITE_GEMINI_API_KEY in Project Settings → Environment Variables
 *
 * Get a free key at: https://aistudio.google.com/apikey
 * ─────────────────────────────────────────────────────────────
 */

export const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? '';
