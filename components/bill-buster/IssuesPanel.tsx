"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Issue, IssueType } from "@/lib/types/bill-analysis";
import { GENERAL_TIPS } from "@/lib/types/bill-analysis";

interface IssuesPanelProps {
  issues: Issue[];
  generalTips: string[];
  onIssueHover?: (issue: Issue | null) => void;
  onIssueClick?: (issue: Issue) => void;
  showHeader?: boolean;
}

function IssueIcon({ type }: { type: IssueType }) {
  const icons: Record<IssueType, React.ReactNode> = {
    duplicate: (
      <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
    unbundling: (
      <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
      </svg>
    ),
    upcoding: (
      <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
    inflated: (
      <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    missed_discount: (
      <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
      </svg>
    ),
  };
  return icons[type] || icons.inflated;
}

export default function IssuesPanel({
  issues,
  generalTips,
  onIssueHover,
  onIssueClick,
  showHeader = true,
}: IssuesPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleIssueClick = (issue: Issue) => {
    setExpandedId(expandedId === issue.id ? null : issue.id);
    onIssueClick?.(issue);
  };

  const totalSavings = issues.reduce((sum, issue) => sum + issue.estimatedSavings, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      {showHeader && (
        <div className="px-4 py-3 border-b border-[#E5E7EB] bg-white">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-[#17270C]">
              {issues.length > 0 ? (
                <>
                  Issues Found{" "}
                  <span className="ml-2 px-2 py-0.5 bg-[#DC2626] text-white text-xs rounded-full">
                    {issues.length}
                  </span>
                </>
              ) : (
                "No Issues Found"
              )}
            </h3>
            {totalSavings > 0 && (
              <span className="text-sm font-medium text-[#5A9A6B]">
                Up to ${totalSavings.toLocaleString()}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Issues list */}
      <div className="flex-1 overflow-y-auto">
        {issues.length > 0 ? (
          <div className="p-3 space-y-2">
            {issues.map((issue) => {
              const isExpanded = expandedId === issue.id;
              return (
                <div
                  key={issue.id}
                  className={cn(
                    "bg-white border border-[#E5E7EB] rounded-xl overflow-hidden transition-all",
                    "hover:border-[#DC2626]/50 cursor-pointer"
                  )}
                  onMouseEnter={() => onIssueHover?.(issue)}
                  onMouseLeave={() => onIssueHover?.(null)}
                  onClick={() => handleIssueClick(issue)}
                >
                  {/* Issue header */}
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="size-10 bg-[#FEF2F2] rounded-xl flex items-center justify-center flex-shrink-0 text-[#DC2626]">
                        <IssueIcon type={issue.type} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h4 className="font-medium text-[#17270C]">{issue.title}</h4>
                            <p className="text-sm text-[#6B7280] mt-0.5 line-clamp-2">
                              {issue.shortDescription}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="text-lg font-semibold text-[#5A9A6B] tabular-nums">
                              -${issue.estimatedSavings.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0 border-t border-[#E5E7EB] mt-0">
                      <div className="pt-4 space-y-4">
                        <div>
                          <h5 className="text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-2">
                            Explanation
                          </h5>
                          <p className="text-sm text-[#17270C]">{issue.fullExplanation}</p>
                        </div>
                        <div className="p-3 bg-[#F2FBEF] rounded-lg">
                          <h5 className="text-xs font-medium text-[#5A9A6B] uppercase tracking-wide mb-2">
                            What to say
                          </h5>
                          <p className="text-sm text-[#17270C] italic">
                            &ldquo;{issue.disputeLanguage}&rdquo;
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-4">
            <div className="p-4 bg-[#F2FBEF] rounded-xl mb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="size-10 bg-[#5A9A6B] rounded-full flex items-center justify-center">
                  <svg className="size-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-medium text-[#17270C]">Looking Good</h4>
                  <p className="text-sm text-[#6B7280]">No obvious errors detected</p>
                </div>
              </div>
              <p className="text-sm text-[#6B7280]">
                We didn&apos;t find any clear billing errors, but that doesn&apos;t mean you can&apos;t
                negotiate. Try these tips:
              </p>
            </div>

            <div className="space-y-3">
              {(generalTips.length > 0 ? generalTips : GENERAL_TIPS).map((tip, i) => (
                <div key={i} className="flex gap-3 p-3 bg-white border border-[#E5E7EB] rounded-xl">
                  <div className="size-6 bg-[#002125] rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-medium">
                    {i + 1}
                  </div>
                  <p className="text-sm text-[#17270C]">{tip}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
