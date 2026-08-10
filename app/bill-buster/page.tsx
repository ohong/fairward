"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import UploadDropzone from "@/components/bill-buster/UploadDropzone";
import BillViewer from "@/components/bill-buster/BillViewer";
import IssuesChatTabs from "@/components/bill-buster/IssuesChatTabs";
import SummaryBar from "@/components/bill-buster/SummaryBar";
import CaseDocumentModal from "@/components/bill-buster/CaseDocumentModal";
import PaymentModal from "@/components/bill-buster/PaymentModal";
import AutopilotModal from "@/components/bill-buster/AutopilotModal";
import type { BillAnalysis, AnalysisStage, Issue } from "@/lib/types/bill-analysis";
import { ANALYSIS_STAGES } from "@/lib/types/bill-analysis";
import { buildInitialChatMessage } from "@/lib/bill-analysis-client";

type PageState = "empty" | "loading" | "results" | "error";

function ArrowIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
    </svg>
  );
}

export default function BillBusterPage() {
  const [pageState, setPageState] = useState<PageState>("empty");
  const [analysisStage, setAnalysisStage] = useState<AnalysisStage>("uploading");
  const [analysis, setAnalysis] = useState<BillAnalysis | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileType, setFileType] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [highlightedIssueId, setHighlightedIssueId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [caseDocument, setCaseDocument] = useState<string>("");
  const [isGeneratingCase, setIsGeneratingCase] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [showAutopilotModal, setShowAutopilotModal] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    setPageState("loading");
    setAnalysisStage("uploading");
    setError(null);

    const url = URL.createObjectURL(file);
    setFileUrl(url);
    setFileType(file.type);

    const stages: AnalysisStage[] = ["reading", "parsing", "checking", "benchmarking"];
    let stageIndex = 0;

    const progressInterval = setInterval(() => {
      if (stageIndex < stages.length) {
        setAnalysisStage(stages[stageIndex]);
        stageIndex++;
      }
    }, 2000);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/bill-buster/analyze", {
        method: "POST",
        body: formData,
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Analysis failed");
      }

      const data = await response.json();
      setAnalysis(data.data);
      setAnalysisStage("complete");
      setPageState("results");
    } catch (err) {
      clearInterval(progressInterval);
      setError(err instanceof Error ? err.message : "Something went wrong");
      setAnalysisStage("error");
      setPageState("error");
    }
  }, []);

  const handleReset = useCallback(() => {
    if (fileUrl) {
      URL.revokeObjectURL(fileUrl);
    }
    setPageState("empty");
    setAnalysis(null);
    setFileUrl(null);
    setFileType("");
    setError(null);
    setHighlightedIssueId(null);
    setCaseDocument("");
  }, [fileUrl]);

  const handleIssueHover = useCallback((issue: Issue | null) => {
    setHighlightedIssueId(issue?.id ?? null);
  }, []);

  const handleIssueClick = useCallback((issue: Issue) => {
    setHighlightedIssueId(issue.id);
  }, []);

  const handleGenerateCase = useCallback(async () => {
    if (!analysis) return;

    setIsGeneratingCase(true);

    try {
      const response = await fetch("/api/bill-buster/generate-case", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate case document");
      }

      const data = await response.json();
      setCaseDocument(data.document);
      setIsModalOpen(true);
    } catch (err) {
      console.error("Generate case error:", err);
    } finally {
      setIsGeneratingCase(false);
    }
  }, [analysis]);

  const handlePaymentComplete = useCallback(() => {
    setPaymentComplete(true);
    setShowPaymentModal(false);
  }, []);

  const currentStage = ANALYSIS_STAGES[analysisStage];

  return (
    <div className="min-h-dvh bg-[#F9FAFB] text-[#17270C] selection:bg-[#98FB98] selection:text-[#002125]">
      {/* Navigation - matches home page */}
      <nav
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
          isScrolled || pageState !== "empty"
            ? "bg-white border-b border-[#E5E7EB]"
            : "bg-transparent"
        )}
      >
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="group">
            <span className="text-2xl font-semibold group-hover:opacity-80 transition-opacity">
              <span className={cn(
                "transition-colors duration-300",
                isScrolled || pageState !== "empty" ? "text-[#17270C]" : "text-white"
              )}>Just</span>
              <span className={cn(
                "transition-colors duration-300",
                isScrolled || pageState !== "empty" ? "text-[#5A9A6B]" : "text-[#98FB98]"
              )}>Price</span>
            </span>
          </Link>

          {pageState === "results" ? (
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#6B7280] hover:text-[#17270C] transition-colors bg-white/80 backdrop-blur-sm rounded-full border border-[#E5E7EB]"
            >
              <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              New Bill
            </button>
          ) : (
            <Link
              href="/query"
              className={cn(
                "btn-primary no-underline",
                !isScrolled && pageState === "empty" && "bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20"
              )}
            >
              <span>Search Prices</span>
              <span className="btn-arrow">
                <ArrowIcon />
              </span>
            </Link>
          )}
        </div>
      </nav>

      {/* Empty State - Hero with dark background */}
      {pageState === "empty" && (
        <main className="relative h-dvh flex flex-col overflow-hidden">
          {/* Full-bleed hero background */}
          <div className="absolute inset-0">
            <Image
              src="/images/bill-buster-hero.jpg"
              alt=""
              fill
              className="object-cover"
              priority
            />
            {/* Dark overlay for text legibility */}
            <div className="absolute inset-0 bg-[#002125]/85" />
          </div>

          {/* Hero Content - flexible area */}
          <div className="relative flex-1 flex flex-col justify-center pt-16 px-4 sm:px-6">
            <div className="max-w-3xl mx-auto text-center">
              {/* Headline */}
              <h1 className="text-4xl md:text-6xl font-bold text-white mb-4 text-balance leading-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
                Fight your bill.
                <br />
                <span className="text-[#98FB98]">Win.</span>
              </h1>

              {/* Subheadline */}
              <p className="text-base md:text-lg text-white/90 max-w-lg mx-auto mb-6 text-pretty leading-relaxed drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
                Upload your bill. Our AI finds errors and drafts your dispute letter.
              </p>

              {/* Stats */}
              <p className="text-sm text-[#98FB98] font-medium">
                74% of challenged bills get reduced
              </p>
            </div>
          </div>

          {/* Upload Section - fixed at bottom */}
          <div className="relative flex-shrink-0 px-4 sm:px-6 pb-6 pt-4">
            <div className="max-w-xl mx-auto">
              <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-xl p-6">
                <div className="text-center mb-4">
                  <h2 className="text-lg font-medium text-[#17270C] mb-1">
                    Upload your bill to get started
                  </h2>
                  <p className="text-sm text-[#6B7280]">
                    PDF, PNG, or JPG up to 10MB
                  </p>
                </div>
                <UploadDropzone onFileSelect={handleFileSelect} />
              </div>

              {/* Trust indicators */}
              <div className="mt-4 flex flex-wrap justify-center gap-4">
                {[
                  { icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z", text: "Private & secure" },
                  { icon: "M13 10V3L4 14h7v7l9-11h-7z", text: "Analysis in seconds" },
                  { icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", text: "Free to use" }
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-white/70">
                    <svg className="size-3.5 text-[#98FB98]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                    </svg>
                    {item.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      )}

      {/* Loading State */}
      {pageState === "loading" && (
        <main className="pt-24 px-4 sm:px-6">
          <div className="max-w-4xl mx-auto py-16">
            <div className="text-center mb-12">
              {/* Animated scan illustration */}
              <div className="relative w-24 h-24 mx-auto mb-8">
                <Image
                  src="/images/bill-buster-scan.jpg"
                  alt=""
                  fill
                  className="object-cover rounded-2xl"
                />
                {/* Scanning line animation */}
                <div className="absolute inset-0 rounded-2xl overflow-hidden">
                  <div
                    className="absolute left-0 right-0 h-1 bg-[#98FB98]/60"
                    style={{
                      animation: "scan 2s ease-in-out infinite",
                    }}
                  />
                </div>
                <div className="absolute inset-0 rounded-2xl ring-2 ring-[#002125]/10" />
              </div>

              <h2 className="text-2xl font-serif text-[#17270C] mb-2">
                Analyzing your bill
              </h2>
              <p className="text-[#6B7280] mb-8">
                {currentStage.message}
              </p>

              {/* Progress bar */}
              <div className="max-w-sm mx-auto">
                <div className="h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#002125] rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${currentStage.percent}%` }}
                  />
                </div>
                <p className="text-xs text-[#6B7280] mt-3 tabular-nums">
                  {currentStage.percent}% complete
                </p>
              </div>
            </div>

            {/* Skeleton layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="h-[500px] bg-white rounded-xl border border-[#E5E7EB]">
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <div className="size-12 bg-[#F2FBEF] rounded-xl flex items-center justify-center mx-auto mb-4">
                      <svg className="size-6 text-[#5A9A6B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <p className="text-sm text-[#6B7280]">Processing document...</p>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="h-48 bg-white rounded-xl border border-[#E5E7EB] p-6">
                  <div className="space-y-3">
                    <div className="h-4 bg-[#F2FBEF] rounded w-1/3" />
                    <div className="h-3 bg-[#F9FAFB] rounded w-full" />
                    <div className="h-3 bg-[#F9FAFB] rounded w-2/3" />
                  </div>
                </div>
                <div className="h-48 bg-white rounded-xl border border-[#E5E7EB] p-6">
                  <div className="space-y-3">
                    <div className="h-4 bg-[#F2FBEF] rounded w-1/4" />
                    <div className="h-3 bg-[#F9FAFB] rounded w-full" />
                    <div className="h-3 bg-[#F9FAFB] rounded w-3/4" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Scanning animation keyframes */}
          <style jsx>{`
            @keyframes scan {
              0%, 100% { top: 0; opacity: 0; }
              10% { opacity: 1; }
              90% { opacity: 1; }
              100% { top: 100%; opacity: 0; }
            }
          `}</style>
        </main>
      )}

      {/* Error State */}
      {pageState === "error" && (
        <main className="pt-24 px-4 sm:px-6">
          <div className="max-w-md mx-auto py-16 text-center">
            <div className="size-16 bg-[#FEF2F2] rounded-2xl flex items-center justify-center mx-auto mb-6">
              <svg className="size-8 text-[#DC2626]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-2xl font-serif text-[#17270C] mb-3">
              Something went wrong
            </h2>
            <p className="text-[#6B7280] mb-8 text-pretty">
              {error || "We couldn't analyze your bill. Please try again with a clearer image."}
            </p>
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#002125] text-[#CEFDCE] rounded-xl font-medium hover:bg-[#012E33] transition-colors"
            >
              <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Try Again
            </button>
          </div>
        </main>
      )}

      {/* Results State */}
      {pageState === "results" && analysis && fileUrl && (
        <>
          {/* Full height container with flex layout */}
          <div className="h-dvh flex flex-col">
            {/* Main content area - fills remaining space */}
            <main className="flex-1 pt-20 px-4 sm:px-6 pb-4 overflow-hidden">
              {/* Victory Background - subtle when there are savings */}
              {analysis.totals.potentialSavings.max > 0 && (
                <div className="fixed top-0 right-0 w-[400px] h-[400px] pointer-events-none opacity-10 -z-10">
                  <Image
                    src="/images/bill-buster-victory.jpg"
                    alt=""
                    fill
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-l from-transparent to-[#F9FAFB]" />
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#F9FAFB]" />
                </div>
              )}

              <div className="max-w-7xl mx-auto h-full">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
                  {/* Left: Bill Viewer */}
                  <div className="h-full min-h-0">
                    <BillViewer
                      fileUrl={fileUrl}
                      fileType={fileType}
                      issues={analysis.issues}
                      onIssueClick={handleIssueClick}
                      highlightedIssueId={highlightedIssueId}
                    />
                  </div>

                  {/* Right: Issues + Chat (tabs) */}
                  <div className="h-full min-h-0">
                    <IssuesChatTabs
                      issues={analysis.issues}
                      generalTips={analysis.generalTips}
                      billAnalysis={analysis}
                      initialMessage={buildInitialChatMessage(analysis)}
                      onIssueHover={handleIssueHover}
                      onIssueClick={handleIssueClick}
                    />
                  </div>
                </div>
              </div>
            </main>

            {/* Summary Bar - fixed at bottom, part of flex layout */}
            <SummaryBar
              totalBilled={analysis.totals.billed}
              fairEstimate={analysis.totals.fairEstimate}
              potentialSavings={analysis.totals.potentialSavings}
              issueCount={analysis.issues.length}
              onGenerateCase={handleGenerateCase}
              isGenerating={isGeneratingCase}
            />
          </div>

          {/* Case Document Modal */}
          <CaseDocumentModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            documentContent={caseDocument}
            providerName={analysis.provider.name || undefined}
            savingsAmount={analysis.totals.potentialSavings.max}
            paymentComplete={paymentComplete}
            onPayClick={() => {
              setIsModalOpen(false);
              setShowPaymentModal(true);
            }}
            onAutopilotClick={() => {
              setIsModalOpen(false);
              setShowAutopilotModal(true);
            }}
          />

          {/* Payment Modal */}
          <PaymentModal
            isOpen={showPaymentModal}
            onClose={() => setShowPaymentModal(false)}
            onPaymentComplete={handlePaymentComplete}
            savingsAmount={analysis.totals.potentialSavings.max}
          />

          {/* Autopilot Modal */}
          <AutopilotModal
            isOpen={showAutopilotModal}
            onClose={() => setShowAutopilotModal(false)}
            providerName={analysis.provider.name || undefined}
            savingsAmount={analysis.totals.potentialSavings.max}
          />
        </>
      )}
    </div>
  );
}
