"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { BillAnalysis, Issue } from "@/lib/types/bill-analysis";
import IssuesPanel from "@/components/bill-buster/IssuesPanel";
import BillChat from "@/components/bill-buster/BillChat";

interface IssuesChatTabsProps {
  issues: Issue[];
  generalTips: string[];
  billAnalysis: BillAnalysis;
  initialMessage: string;
  onIssueHover?: (issue: Issue | null) => void;
  onIssueClick?: (issue: Issue) => void;
}

type TabKey = "issues" | "chat";

export default function IssuesChatTabs({
  issues,
  generalTips,
  billAnalysis,
  initialMessage,
  onIssueHover,
  onIssueClick,
}: IssuesChatTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(
    issues.length > 0 ? "issues" : "chat"
  );

  const totalSavings = useMemo(
    () => issues.reduce((sum, issue) => sum + issue.estimatedSavings, 0),
    [issues]
  );

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#E5E7EB] bg-[#F9FAFB]">
        <div className="flex items-center gap-1 rounded-lg p-1 bg-white border border-[#E5E7EB]">
          <button
            type="button"
            onClick={() => setActiveTab("issues")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              activeTab === "issues"
                ? "bg-[#002125] text-white"
                : "text-[#17270C] hover:bg-[#F2FBEF]"
            )}
            aria-pressed={activeTab === "issues"}
          >
            Issues Found
            {issues.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] rounded-full bg-[#DC2626] text-white">
                {issues.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("chat")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              activeTab === "chat"
                ? "bg-[#002125] text-white"
                : "text-[#17270C] hover:bg-[#F2FBEF]"
            )}
            aria-pressed={activeTab === "chat"}
          >
            Chat
          </button>
        </div>
        {activeTab === "issues" && totalSavings > 0 && (
          <span className="text-xs font-medium text-[#5A9A6B]">
            Up to ${totalSavings.toLocaleString()}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0">
        {activeTab === "issues" ? (
          <IssuesPanel
            issues={issues}
            generalTips={generalTips}
            onIssueHover={onIssueHover}
            onIssueClick={onIssueClick}
            showHeader={false}
          />
        ) : (
          <BillChat
            billAnalysis={billAnalysis}
            initialMessage={initialMessage}
            variant="embedded"
          />
        )}
      </div>
    </div>
  );
}
