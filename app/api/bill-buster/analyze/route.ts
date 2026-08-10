import { NextRequest, NextResponse } from "next/server";
import {
  extractTextFromImage,
  parseBillStructure,
  benchmarkPrices,
  detectIssues,
} from "@/lib/bill-analysis";
import type { BillAnalysis, AnalyzeResponse } from "@/lib/types/bill-analysis";
import {
  MAX_FILE_SIZE_BYTES,
  ACCEPTED_FILE_TYPES,
  GENERAL_TIPS,
} from "@/lib/types/bill-analysis";

export const maxDuration = 60; // Allow up to 60s for full analysis

export async function POST(req: NextRequest) {
  const startTime = performance.now();
  const timing = {
    ocr_ms: 0,
    parse_ms: 0,
    benchmark_ms: 0,
    issues_ms: 0,
    total_ms: 0,
  };

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    // Validate file
    if (!file) {
      return NextResponse.json(
        { error: "No file provided", success: false },
        { status: 400 }
      );
    }

    if (!ACCEPTED_FILE_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          error: `Invalid file type: ${file.type}. Accepted: PDF, PNG, JPG`,
          success: false,
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: 20MB`,
          success: false,
        },
        { status: 400 }
      );
    }

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    // Step 1: OCR - Extract text from image
    const ocrStart = performance.now();
    let rawText: string;
    try {
      rawText = await extractTextFromImage(base64, file.type);
    } catch (error) {
      console.error("OCR error:", error);
      return NextResponse.json(
        {
          error: "Could not read the bill. Please upload a clearer image.",
          success: false,
        },
        { status: 422 }
      );
    }
    timing.ocr_ms = performance.now() - ocrStart;

    if (!rawText || rawText.trim().length < 50) {
      return NextResponse.json(
        {
          error: "Could not extract text from the file. Please upload a clearer image.",
          success: false,
        },
        { status: 422 }
      );
    }

    // Step 2: Parse bill structure
    const parseStart = performance.now();
    let parsedBill;
    try {
      parsedBill = await parseBillStructure(rawText);
    } catch (error) {
      console.error("Parse error:", error);
      return NextResponse.json(
        {
          error: "Could not parse the bill structure. This may not be a medical bill.",
          success: false,
        },
        { status: 422 }
      );
    }
    timing.parse_ms = performance.now() - parseStart;

    // Step 3: Benchmark prices
    const benchmarkStart = performance.now();
    let lineItemsWithBenchmarks;
    try {
      lineItemsWithBenchmarks = await benchmarkPrices(
        parsedBill.lineItems,
        "San Francisco Bay Area"
      );
    } catch (error) {
      console.error("Benchmark error:", error);
      // Continue without benchmarks
      lineItemsWithBenchmarks = parsedBill.lineItems.map((item) => ({
        ...item,
        benchmarkAmount: null,
        benchmarkSource: null,
        variance: null,
        flag: null,
      }));
    }
    timing.benchmark_ms = performance.now() - benchmarkStart;

    // Step 4: Detect issues
    const issuesStart = performance.now();
    let issues: Awaited<ReturnType<typeof detectIssues>> = [];
    try {
      issues = await detectIssues(lineItemsWithBenchmarks, rawText);
    } catch (error) {
      console.error("Issue detection error:", error);
      issues = [];
    }
    timing.issues_ms = performance.now() - issuesStart;

    // Calculate totals
    const totalBilled = parsedBill.totalBilled || lineItemsWithBenchmarks.reduce(
      (sum, item) => sum + item.billedAmount,
      0
    );
    const fairEstimateRaw = lineItemsWithBenchmarks.reduce(
      (sum, item) => sum + (item.benchmarkAmount || item.billedAmount),
      0
    );
    const savingsFromIssues = issues.reduce((sum, issue) => sum + issue.estimatedSavings, 0);

    let fairEstimate = Number.isFinite(fairEstimateRaw) ? fairEstimateRaw : totalBilled;

    if (totalBilled > 0 && savingsFromIssues > 0) {
      fairEstimate = Math.min(
        fairEstimate,
        Math.max(0, totalBilled - savingsFromIssues)
      );
    }

    const savingsFloor = totalBilled > 0 ? Math.max(1, Math.round(totalBilled * 0.01)) : 0;
    if (totalBilled > 0 && fairEstimate >= totalBilled) {
      fairEstimate = Math.max(0, totalBilled - savingsFloor);
    }

    const savingsFromEstimate = Math.max(0, Math.round(totalBilled - fairEstimate));
    const maxSavings = Math.max(savingsFromIssues, savingsFromEstimate);
    const minSavings = maxSavings > 0 ? Math.round(maxSavings * 0.5) : 0;

    // Build response
    const analysis: BillAnalysis = {
      billType: parsedBill.isItemized ? "itemized" : "summary",
      provider: parsedBill.provider,
      dateOfService: parsedBill.dateOfService,
      accountNumber: parsedBill.accountNumber,
      totals: {
        billed: totalBilled,
        fairEstimate,
        potentialSavings: {
          min: minSavings, // Conservative
          max: maxSavings,
        },
      },
      lineItems: lineItemsWithBenchmarks,
      issues,
      generalTips: GENERAL_TIPS,
      rawText,
    };

    timing.total_ms = performance.now() - startTime;

    const response: AnalyzeResponse = {
      success: true,
      data: analysis,
      timing,
    };

    return NextResponse.json(response, {
      headers: {
        "X-OCR-Time-Ms": timing.ocr_ms.toFixed(0),
        "X-Parse-Time-Ms": timing.parse_ms.toFixed(0),
        "X-Benchmark-Time-Ms": timing.benchmark_ms.toFixed(0),
        "X-Total-Time-Ms": timing.total_ms.toFixed(0),
      },
    });
  } catch (error) {
    console.error("Analyze error:", error);
    timing.total_ms = performance.now() - startTime;

    return NextResponse.json(
      {
        error: "An unexpected error occurred. Please try again.",
        success: false,
      },
      { status: 500 }
    );
  }
}
