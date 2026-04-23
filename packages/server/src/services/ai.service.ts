// Adapted from listflow/src/services/ai.service.ts.
//
// Sends one or more photos to Claude in a single multi-image prompt and
// returns either:
//   - "these are all (different angles of) one item, here are its fields", or
//   - "these are N distinct items, here are their per-item fields", or
//   - (when given a continuation hint) "yes/no this matches the existing item".
//
// Pricing-aware: returns USD cost from input/output token usage.

import fs from 'node:fs';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../util/logger.js';
import { prisma } from '../db/prisma.js';

const INGEST_HINT_KEY = 'ingest_hint';

async function loadIngestHint(): Promise<string> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: INGEST_HINT_KEY } });
    return (row?.value as { text?: string } | null)?.text?.trim() ?? '';
  } catch {
    return '';
  }
}

// Claude Sonnet 4.6 pricing per 1M tokens (USD). Check Anthropic pricing page
// before considering these authoritative; numbers match Sonnet-4-class tiers.
const INPUT_PRICE_PER_M = 3.0;
const OUTPUT_PRICE_PER_M = 15.0;

const MAX_LONG_EDGE = 1500;

// What we expect Claude to return for a candidate group. Each "groups" entry
// represents a real-world item; if the group input was actually 2 distinct
// items mixed together, Claude can split them.
export const ItemDraftSchema = z.object({
  title: z.string().max(120),
  description: z.string().optional(),
  brand: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  category: z.string().optional(),
  ebayCategoryId: z.string().optional(),
  condition: z.string().optional(),
  conditionId: z.number().int().optional(),
  features: z.array(z.string()).optional().default([]),
  keywords: z.array(z.string()).optional().default([]),
  itemSpecifics: z.record(z.string()).optional().default({}),
  upc: z.string().optional().nullable(),
  isbn: z.string().optional().nullable(),
  mpn: z.string().optional().nullable(),
  estimatedValueUsd: z.number().optional(),
});

export const AnalysisResultSchema = z.object({
  groups: z.array(
    z.object({
      photoIndices: z.array(z.number().int()),
      isContinuationOfExistingItem: z.boolean().default(false),
      existingItemMatchConfidence: z.number().min(0).max(1).default(0),
      item: ItemDraftSchema,
      confidence: z.number().min(0).max(1).default(0),
    }),
  ),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type ItemDraft = z.infer<typeof ItemDraftSchema>;

export interface PhotoForAnalysis {
  index: number;
  filePath: string;
  filename: string;
  capturedAt?: Date | null;
  perceptualHash?: string | null;
}

export interface ContinuationHint {
  itemId: string;
  itemTitle: string;
  representativePhotoPaths: string[]; // 2 photos of the existing item
}

export interface AnalyzeOptions {
  photos: PhotoForAnalysis[];
  continuation?: ContinuationHint;
  // Free-text context supplied for this specific identification run —
  // from the /groups/:id/identify-ai endpoint. Appended to the Claude
  // prompt as a separate block after the global ingest_hint.
  context?: string;
  // Optional eBay Browse image-search priors (top hits from
  // searchByImage on the primary photo) injected as identification
  // hints. Let Claude use, not copy.
  visualMatches?: Array<{ title: string; category?: string; condition?: string; itemSpecifics?: Record<string, string> }>;
}

export interface AnalyzeResponse {
  result: AnalysisResult;
  costUsd: number;
}

const SYSTEM_PROMPT = `You are an expert eBay reseller cataloger. You will be shown 1–20 photos of one or more physical items. Return STRICT JSON matching the schema described in the user message.

Pay HIGH attention to filename + capture-timestamp metadata embedded in each image's preceding text block — consecutive filenames AND tight timestamps STRONGLY indicate that photos are different angles of the SAME item. Do not split a clearly-coherent burst into multiple items unless the visual evidence is unambiguous.

When given an EXISTING ITEM hint, your primary job is to answer whether the new photos are another angle of that same physical object. Set isContinuationOfExistingItem=true with confidence ≥ 0.75 only when you are confident the photos depict the same single object.

READ ALL VISIBLE TEXT. Carefully inspect every photo for text on the item itself — labels, nameplates, stickers, stamped/embossed/engraved marks, printed brand names, tags, packaging. Extract the highest-value identifiers first:
  • BRAND (manufacturer's name) → Brand
  • MODEL or model number → Model
  • MANUFACTURER PART NUMBER (MPN, part #, catalog #) → mpn and itemSpecifics.MPN
  • UPC / EAN / ISBN → upc / isbn
  • SERIAL NUMBER, PATENT NUMBER, COUNTRY OF ORIGIN, MATERIAL, SIZE, CAPACITY
If you see ANY printed or stamped identifier, put the literal string in the matching field — even fragments ("PAT. PEND.", "MADE IN JAPAN", "Cat. No. 1234") are useful. Do NOT guess values for fields where no text is visible; leave them null.

Item specifics should use eBay-standard names ("Brand", "Model", "Color", "Material", "Type", "MPN", "Country/Region of Manufacture", etc.).`;

class AIService {
  private client: Anthropic | null = null;

  constructor() {
    if (env.ANTHROPIC_API_KEY) {
      this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    } else {
      logger.warn('ANTHROPIC_API_KEY not set — AI service will return mocks');
    }
  }

  async analyze(opts: AnalyzeOptions): Promise<AnalyzeResponse> {
    if (!this.client) return { result: this.mock(opts), costUsd: 0 };

    const userBlocks: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    > = [];

    // User-supplied context hint (from /settings/ingest-hint) — biases
    // Claude toward the seller's known inventory context (e.g. "these are
    // antique hardware; prefer treating an assembled fixture as one item").
    const hint = await loadIngestHint();
    if (hint) {
      userBlocks.push({ type: 'text', text: `CATALOG CONTEXT from seller — apply to all groupings/titles:\n${hint}` });
    }

    // Per-run context from the folder-detail UI. Takes precedence over the
    // global ingest hint when both are set; both are included for coverage.
    if (opts.context && opts.context.trim()) {
      userBlocks.push({
        type: 'text',
        text: `PER-RUN CONTEXT from user — applies to this identification only:\n${opts.context.trim()}`,
      });
    }

    // Visual priors from eBay Browse searchByImage. Use as hints — do not
    // copy values blindly. These identify likely brand/model/category for
    // items whose printed text is absent or illegible.
    if (opts.visualMatches && opts.visualMatches.length > 0) {
      const lines = opts.visualMatches.slice(0, 5).map((m, i) => {
        const parts = [`#${i + 1}: "${m.title}"`];
        if (m.category) parts.push(`category: ${m.category}`);
        if (m.condition) parts.push(`condition: ${m.condition}`);
        if (m.itemSpecifics && Object.keys(m.itemSpecifics).length > 0) {
          parts.push(`specifics: ${JSON.stringify(m.itemSpecifics)}`);
        }
        return parts.join(' · ');
      });
      userBlocks.push({
        type: 'text',
        text: `VISUAL MATCHES from eBay image search — use as hints to identify the item; verify against the actual photos; do not copy values not supported by the images:\n${lines.join('\n')}`,
      });
    }

    // Continuation hint goes first so Claude's attention is anchored.
    if (opts.continuation) {
      userBlocks.push({
        type: 'text',
        text: `EXISTING ITEM context — title: "${opts.continuation.itemTitle}". Below are 2 representative photos of the existing item. Decide whether the SUBSEQUENT new photos are different angles of this SAME object.`,
      });
      for (const p of opts.continuation.representativePhotoPaths) {
        const img = await this.loadImage(p);
        if (img) userBlocks.push(img);
      }
      userBlocks.push({ type: 'text', text: '— END EXISTING ITEM CONTEXT — new photos follow:' });
    }

    for (const p of opts.photos) {
      const meta = `Photo ${p.index} — filename: ${p.filename}` +
        (p.capturedAt ? `, capturedAt: ${p.capturedAt.toISOString()}` : '') +
        (p.perceptualHash ? `, perceptualHash: ${p.perceptualHash}` : '');
      userBlocks.push({ type: 'text', text: meta });
      const img = await this.loadImage(p.filePath);
      if (img) userBlocks.push(img);
    }

    userBlocks.push({
      type: 'text',
      text: `Return JSON of shape:
{
  "groups": [
    {
      "photoIndices": [<int>...],
      "isContinuationOfExistingItem": <bool>,
      "existingItemMatchConfidence": <0..1>,
      "item": {
        "title": "<≤80 chars>",
        "description": "<plain text>",
        "brand": "<string|null>",
        "model": "<string|null>",
        "category": "<eBay-style breadcrumb>",
        "condition": "New|Like New|Very Good|Good|Acceptable|For Parts",
        "features": ["..."],
        "keywords": ["..."],
        "itemSpecifics": { "Brand": "...", "Model": "...", "Color": "..." },
        "upc": "<string|null>",
        "isbn": "<string|null>",
        "mpn": "<string|null>"
      },
      "confidence": <0..1>
    }
  ]
}
Output JSON only — no prose, no markdown fences.`,
    });

    const response = await this.client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      // Cast: SDK's content type uses internal namespaces that vary by version.
      messages: [{ role: 'user', content: userBlocks as never }],
    });

    const text = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Sometimes a stray ``` block sneaks through despite the instruction.
      const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, '');
      parsed = JSON.parse(stripped);
    }

    const result = AnalysisResultSchema.parse(parsed);

    const costUsd =
      ((response.usage.input_tokens ?? 0) / 1_000_000) * INPUT_PRICE_PER_M +
      ((response.usage.output_tokens ?? 0) / 1_000_000) * OUTPUT_PRICE_PER_M;

    return { result, costUsd: Math.round(costUsd * 1_000_000) / 1_000_000 };
  }

  private async loadImage(
    path: string,
  ): Promise<{ type: 'image'; source: { type: 'base64'; media_type: string; data: string } } | null> {
    try {
      const raw = fs.readFileSync(path);
      const buf = await sharp(raw)
        .resize(MAX_LONG_EDGE, MAX_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      return {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') },
      };
    } catch (err) {
      logger.warn({ err, path }, 'failed to load image for Claude');
      return null;
    }
  }

  private mock(opts: AnalyzeOptions): AnalysisResult {
    return {
      groups: [
        {
          photoIndices: opts.photos.map((p) => p.index),
          isContinuationOfExistingItem: false,
          existingItemMatchConfidence: 0,
          confidence: 0.4,
          item: {
            title: 'Mock Item (no ANTHROPIC_API_KEY)',
            description: 'Set ANTHROPIC_API_KEY to enable real recognition.',
            brand: null,
            model: null,
            category: 'Other',
            condition: 'Used',
            features: [],
            keywords: [],
            itemSpecifics: {},
            upc: null,
            isbn: null,
            mpn: null,
          },
        },
      ],
    };
  }
}

export const aiService = new AIService();
