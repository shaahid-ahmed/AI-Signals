/**
 * config.example.js
 *
 * For LOCAL DEV (without Vite):
 *   Copy this file to config.js and paste your key directly.
 *
 * For VITE / VERCEL (recommended):
 *   Add VITE_GEMINI_API_KEY=your_key to .env.local
 *   config.js already reads from import.meta.env automatically.
 *
 * Get a free key at: https://aistudio.google.com/apikey
 */

export const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? '';
