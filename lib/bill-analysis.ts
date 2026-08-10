/**
 * Bill Buster - Core analysis functions
 */

import { createFireworks } from "@ai-sdk/fireworks";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import type {
  BillAnalysis,
  LineItem,
  Issue,
  ParsedBill,
} from "./types/bill-analysis";
import { MAX_PAGES } from "./types/bill-analysis";

/**
 * Extract JSON from text that may contain markdown code blocks or extra text
 */
function extractJSON(text: string): string {
  // Try to find JSON in markdown code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find JSON object directly
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  return text.trim();
}

const fireworks = createFireworks({
  apiKey: process.env.FIREWORKS_API_KEY,
});

// Vision model for OCR
const VISION_MODEL = "accounts/fireworks/models/qwen3-vl-235b-a22b-instruct";
// Text model for analysis
const TEXT_MODEL = "accounts/fireworks/models/deepseek-v3p1";

/**
 * Convert PDF buffer to array of page images (PNG base64) using pdftoppm (poppler-utils)
 * This approach uses native PDF rendering for best quality and compatibility
 */
async function convertPdfToImages(pdfBuffer: Buffer): Promise<string[]> {
  const { execSync } = await import("child_process");
  const fs = await import("fs");
  const path = await import("path");
  const os = await import("os");

  const images: string[] = [];

  // Create temp directory for PDF and images
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-"));
  const pdfPath = path.join(tempDir, "input.pdf");
  const outputPrefix = path.join(tempDir, "page");

  try {
    // Write PDF to temp file
    fs.writeFileSync(pdfPath, pdfBuffer);

    // Convert PDF to PNG images using pdftoppm
    // -png: output PNG format
    // -r 200: 200 DPI for good OCR quality
    // -l MAX_PAGES: limit to first N pages
    execSync(`pdftoppm -png -r 200 -l ${MAX_PAGES} "${pdfPath}" "${outputPrefix}"`, {
      timeout: 60000, // 60 second timeout
    });

    // Read generated images
    const files = fs.readdirSync(tempDir)
      .filter((f: string) => f.startsWith("page") && f.endsWith(".png"))
      .sort();

    for (const file of files) {
      const imagePath = path.join(tempDir, file);
      const imageBuffer = fs.readFileSync(imagePath);
      images.push(imageBuffer.toString("base64"));
    }

  } finally {
    // Clean up temp directory
    try {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tempDir, file));
      }
      fs.rmdirSync(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  }

  return images;
}

/**
 * Extract text from a single image using vision model
 */
async function extractTextFromSingleImage(
  base64Image: string,
  mimeType: string = "image/png"
): Promise<string> {
  const result = await generateText({
    model: fireworks(VISION_MODEL),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            image: `data:${mimeType};base64,${base64Image}`,
          },
          {
            type: "text",
            text: `Extract ALL text from this medical bill image. Preserve the structure and layout as much as possible. Include:
- Provider/hospital name and address
- Patient account number
- Date(s) of service
- ALL line items with descriptions, codes (CPT/HCPCS if visible), quantities, and amounts
- Subtotals, adjustments, and final totals
- Any billing contact information

Output the text exactly as it appears, maintaining the tabular structure for line items.`,
          },
        ],
      },
    ],
  });

  return result.text;
}

/**
 * Extract text from a bill image or PDF using vision model
 * For PDFs, converts each page to an image first
 */
export async function extractTextFromImage(
  base64Data: string,
  mimeType: string
): Promise<string> {
  // If it's a PDF, convert to images first
  if (mimeType === "application/pdf") {
    const pdfBuffer = Buffer.from(base64Data, "base64");
    const pageImages = await convertPdfToImages(pdfBuffer);

    if (pageImages.length === 0) {
      throw new Error("Could not extract any pages from PDF");
    }

    // Extract text from each page and combine
    const pageTexts: string[] = [];
    for (let i = 0; i < pageImages.length; i++) {
      const pageText = await extractTextFromSingleImage(pageImages[i], "image/png");
      pageTexts.push(`--- Page ${i + 1} ---\n${pageText}`);
    }

    return pageTexts.join("\n\n");
  }

  // For images, process directly
  return extractTextFromSingleImage(base64Data, mimeType);
}

/**
 * Parse extracted text into structured bill data
 */
export async function parseBillStructure(rawText: string): Promise<ParsedBill> {
  const schema = z.object({
    provider: z.object({
      name: z.string().nullable().default(null),
      address: z.string().nullable().default(null),
      billingContact: z.string().nullable().default(null),
    }),
    dateOfService: z.string().nullable().default(null),
    accountNumber: z.string().nullable().default(null),
    lineItems: z.array(
      z.object({
        id: z.string(),
        description: z.string(),
        code: z.string().nullable().default(null),
        codeConfidence: z.enum(["high", "medium", "low"]).default("low"),
        quantity: z.number().default(1),
        billedAmount: z.number(),
      })
    ).default([]),
    totalBilled: z.number().default(0),
    isItemized: z.boolean().default(false),
  });

  try {
    const result = await generateObject({
      model: fireworks(TEXT_MODEL),
      schema,
      prompt: `Parse this medical bill text into structured JSON data. Extract all information available.

You MUST respond with ONLY valid JSON (no markdown, no explanation) matching this exact structure:
{
  "provider": { "name": null, "address": null, "billingContact": null },
  "dateOfService": null,
  "accountNumber": null,
  "lineItems": [
    {
      "id": "item_1",
      "description": "Example description",
      "code": null,
      "codeConfidence": "low",
      "quantity": 1,
      "billedAmount": 0
    }
  ],
  "totalBilled": 0,
  "isItemized": false
}

For each line item:
- Generate a unique ID (e.g., "item_1", "item_2")
- Extract the description
- Extract CPT/HCPCS code if present (set codeConfidence to "high" if clearly visible, "medium" if partially visible, "low" if inferred)
- Extract quantity (default to 1 if not specified)
- Extract the billed amount as a number (remove $ and commas)

Determine if this is an itemized bill (has individual line items) or a summary bill (just totals).

BILL TEXT:
${rawText}

Respond with ONLY the JSON object, no other text.`,
    });

    return schema.parse(result.object) as ParsedBill;
  } catch (error) {
    console.error("parseBillStructure error:", error);
    throw error;
  }
}

/**
 * Benchmark prices for line items using web search context
 */
export async function benchmarkPrices(
  lineItems: ParsedBill["lineItems"],
  region: string = "San Francisco Bay Area"
): Promise<LineItem[]> {
  // If no line items, return empty array
  if (!lineItems || lineItems.length === 0) {
    return [];
  }

  const schema = z.object({
    items: z.array(
      z.object({
        id: z.string(),
        benchmarkAmount: z.number().nullable().default(null),
        benchmarkSource: z.string().nullable().default(null),
        variance: z.number().nullable().default(null),
        flag: z.enum(["fair", "high", "error"]).nullable().default(null),
      })
    ).default([]),
  });

  const itemDescriptions = lineItems
    .map((item) => `- ${item.id}: "${item.description}" (code: ${item.code || "unknown"}) - $${item.billedAmount}`)
    .join("\n");

  try {
    const result = await generateText({
      model: fireworks(TEXT_MODEL),
      prompt: `For each medical service below, estimate the fair market price in ${region} based on your knowledge of typical healthcare costs.

You MUST respond with ONLY valid JSON (no markdown, no explanation) matching this exact structure:
{
  "items": [{ "id": string, "benchmarkAmount": number|null, "benchmarkSource": string|null, "variance": number|null, "flag": "fair"|"high"|"error"|null }]
}

LINE ITEMS:
${itemDescriptions}

For each item, provide:
- benchmarkAmount: Estimated fair price (median) for this service in the region. Use your knowledge of typical costs.
- benchmarkSource: Brief note like "typical regional rate" or "CMS average"
- variance: Percentage the billed amount is above/below benchmark ((billed - benchmark) / benchmark * 100)
- flag: "fair" if within 50% of benchmark, "high" if >50% above, null if cannot determine

Be conservative - only flag as "high" if clearly inflated. Common fair price ranges:
- Basic lab panel: $50-150
- MRI: $500-1500
- CT scan: $300-800
- X-ray: $100-300
- Emergency room visit: $500-2000
- Hospital room per day: $1500-3000

Respond with ONLY the JSON object, no other text.`,
    });

    const parsed = JSON.parse(extractJSON(result.text));
    const validated = schema.parse(parsed);

    // Merge benchmark data with original items
    return lineItems.map((item) => {
      const benchmark = validated.items.find((b) => b.id === item.id);
      return {
        ...item,
        benchmarkAmount: benchmark?.benchmarkAmount ?? null,
        benchmarkSource: benchmark?.benchmarkSource ?? null,
        variance: benchmark?.variance ?? null,
        flag: benchmark?.flag ?? null,
      };
    });
  } catch (error) {
    console.error("benchmarkPrices error:", error);
    // Return items without benchmarks on error
    return lineItems.map((item) => ({
      ...item,
      benchmarkAmount: null,
      benchmarkSource: null,
      variance: null,
      flag: null,
    }));
  }
}

/**
 * Detect billing errors and issues
 */
export async function detectIssues(
  lineItems: LineItem[],
  rawText: string
): Promise<Issue[]> {
  // If no line items, return empty array
  if (!lineItems || lineItems.length === 0) {
    return [];
  }

  const schema = z.object({
    issues: z.array(
      z.object({
        id: z.string(),
        type: z.enum(["duplicate", "unbundling", "upcoding", "inflated", "missed_discount"]),
        title: z.string(),
        shortDescription: z.string(),
        fullExplanation: z.string(),
        disputeLanguage: z.string(),
        affectedLineItems: z.array(z.string()).default([]),
        estimatedSavings: z.number().default(0),
        pageHint: z.number().default(0),
      })
    ).default([]),
  });

  const itemList = lineItems
    .map(
      (item) =>
        `${item.id}: "${item.description}" | Code: ${item.code || "none"} | Qty: ${item.quantity} | Billed: $${item.billedAmount} | Fair: $${item.benchmarkAmount || "?"} | Variance: ${item.variance ? item.variance.toFixed(0) + "%" : "?"}`
    )
    .join("\n");

  try {
    const result = await generateText({
      model: fireworks(TEXT_MODEL),
      prompt: `Analyze this medical bill for errors and overcharges.

You MUST respond with ONLY valid JSON (no markdown, no explanation) matching this exact structure:
{
  "issues": [{ "id": string, "type": "duplicate"|"unbundling"|"upcoding"|"inflated"|"missed_discount", "title": string, "shortDescription": string, "fullExplanation": string, "disputeLanguage": string, "affectedLineItems": string[], "estimatedSavings": number, "pageHint": number }]
}

If no issues are found, return: { "issues": [] }

Look for these issue types:
1. DUPLICATE CHARGES: Same service billed multiple times for single service
2. UNBUNDLING: Panel tests (like Comprehensive Metabolic Panel) billed as individual tests instead of bundled
3. UPCODING: Higher-level code used when lower-level appropriate (e.g., complex visit code for simple visit)
4. INFLATED PRICES: Charges significantly above fair market (>50% variance)
5. MISSED DISCOUNTS: Uninsured discount not applied when it should be

LINE ITEMS:
${itemList}

RAW BILL TEXT (for context):
${rawText.slice(0, 3000)}

For each issue found:
- Generate unique ID (e.g., "issue_1")
- Classify the type
- Write a clear title (e.g., "Duplicate Lab Panel Charge")
- Write shortDescription (1-2 sentences for tooltip)
- Write fullExplanation (detailed explanation for panel)
- Write disputeLanguage (exact wording patient can use when calling)
- List affected line item IDs
- Estimate savings if corrected
- Set pageHint to 0 (first page) - we'll refine positioning later

Be conservative - only flag clear issues. Don't flag if uncertain.

Respond with ONLY the JSON object, no other text.`,
    });

    const parsed = JSON.parse(extractJSON(result.text));
    const validated = schema.parse(parsed);

    // Add bounding boxes (simplified - center of page for now)
    return (validated.issues || []).map((issue) => ({
      ...issue,
      annotation: {
        boundingBox: {
          x: 10,
          y: 20 + Math.random() * 60, // Spread vertically
          width: 80,
          height: 8,
          page: issue.pageHint,
        },
      },
    }));
  } catch (error) {
    console.error("detectIssues error:", error);
    return [];
  }
}

/**
 * Generate the full case document in markdown
 */
export function generateCaseDocument(
  analysis: BillAnalysis,
  patientName: string = "[YOUR NAME]"
): string {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const issuesList = analysis.issues
    .map(
      (issue, i) => `### ${i + 1}. ${issue.title.toUpperCase()} — Estimated Overcharge: $${issue.estimatedSavings.toLocaleString()}

${issue.fullExplanation}

**Affected charges:** ${issue.affectedLineItems.map((id) => {
        const item = analysis.lineItems.find((li) => li.id === id);
        return item ? `${item.description} ($${item.billedAmount})` : id;
      }).join(", ")}

**Request:** ${issue.disputeLanguage}`
    )
    .join("\n\n");

  const totalDisputed = analysis.issues.reduce((sum, i) => sum + i.estimatedSavings, 0);

  return `# Medical Bill Dispute Letter

**Date:** ${today}

**To:**
${analysis.provider.name || "[PROVIDER NAME]"}
${analysis.provider.address || "[PROVIDER ADDRESS]"}
${analysis.provider.billingContact ? `Billing Department: ${analysis.provider.billingContact}` : "Billing Department"}

**RE:** Dispute of Charges
**Account #:** ${analysis.accountNumber || "[ACCOUNT NUMBER]"}
**Date of Service:** ${analysis.dateOfService || "[DATE OF SERVICE]"}
**Patient:** ${patientName}

---

Dear Billing Department,

I am writing to formally dispute charges on my recent medical bill. After careful review of the itemized statement, I have identified the following issues that require correction:

---

## Issues Identified

${issuesList || "*No specific issues identified. See general requests below.*"}

---

## Summary

| Description | Amount |
|-------------|--------|
| **Total Billed** | $${analysis.totals.billed.toLocaleString()} |
| **Estimated Fair Price** | $${analysis.totals.fairEstimate.toLocaleString()} |
| **Total Disputed** | $${totalDisputed.toLocaleString()} |
| **Requested Adjusted Total** | $${(analysis.totals.billed - totalDisputed).toLocaleString()} |

---

## Requested Actions

1. Please review and correct the billing errors identified above
2. Provide an adjusted bill reflecting the corrections
3. If you believe these charges are accurate, please provide documentation justifying each disputed item
4. Please respond in writing within 30 days

## Legal References

- Under the **No Surprises Act** (2022), patients have the right to receive a Good Faith Estimate and dispute charges that exceed the estimate by $400 or more.
- Under **California Civil Code Section 1788**, billing statements must be accurate and free from deceptive practices.
- I am prepared to escalate this matter to the California Department of Managed Health Care or file a complaint with the Consumer Financial Protection Bureau if these issues are not addressed.

---

Please contact me at the information below to discuss this matter.

Sincerely,

**${patientName}**
[YOUR ADDRESS]
[YOUR PHONE]
[YOUR EMAIL]

---

*This document was generated by JustPrice Bill Buster. For more information, visit justprice.com*
`;
}

/**
 * Build chat system prompt with bill context
 */
export function buildChatSystemPrompt(analysis: BillAnalysis): string {
  const lineItemsSummary = analysis.lineItems
    .map(
      (item) =>
        `- ${item.description}: $${item.billedAmount} (fair: $${item.benchmarkAmount || "unknown"})`
    )
    .join("\n");

  const issuesSummary = analysis.issues
    .map((issue) => `- ${issue.title}: ${issue.shortDescription} (savings: $${issue.estimatedSavings})`)
    .join("\n");

  return `You are Bill Buster, a medical billing expert helping patients understand and dispute their hospital bills.

You have access to the user's bill analysis:

**Provider:** ${analysis.provider.name || "Unknown"}
**Date of Service:** ${analysis.dateOfService || "Unknown"}
**Total Billed:** $${analysis.totals.billed.toLocaleString()}
**Estimated Fair Price:** $${analysis.totals.fairEstimate.toLocaleString()}
**Potential Savings:** $${analysis.totals.potentialSavings.min.toLocaleString()} - $${analysis.totals.potentialSavings.max.toLocaleString()}

**Line Items:**
${lineItemsSummary}

**Issues Found:**
${issuesSummary || "No specific issues identified"}

**Your role:**
1. Answer questions about the bill in plain, simple language
2. Explain medical billing terms (CPT codes, unbundling, upcoding, etc.)
3. Help the user understand why charges may be unfair
4. Suggest specific questions to ask the billing department
5. Provide encouragement—most people who dispute their bills get them reduced

**Guidelines:**
- Use simple language. Avoid jargon. The user may not be tech-savvy.
- Be supportive and empowering, not alarmist.
- When citing prices or benchmarks, note these are estimates.
- If you don't know something, say so and suggest the user ask the billing department.
- Be concise - this is a chat interface.

**Do not:**
- Provide legal advice
- Guarantee specific savings amounts
- Make claims about what the hospital "must" do (use "should" or "typically")`;
}
