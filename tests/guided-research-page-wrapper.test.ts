import { isValidElement, type ElementType, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  workspaceOptionsForSession: vi.fn((session: { archiveId: string }) => ({
    archiveId: session.archiveId
  }))
}));
const configMocks = vi.hoisted(() => ({
  isGuidedResearchEnabled: vi.fn()
}));
const dashboardMocks = vi.hoisted(() => ({
  buildDashboardSummary: vi.fn()
}));
const guideMocks = vi.hoisted(() => ({
  buildResearchGuide: vi.fn()
}));
const workspaceMocks = vi.hoisted(() => ({
  readWorkspace: vi.fn()
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/lib/auth-session", () => authMocks);
vi.mock("@/lib/guided-research-config", () => configMocks);
vi.mock("@/lib/dashboard", () => dashboardMocks);
vi.mock("@/lib/research-guide", () => guideMocks);
vi.mock("@/lib/workspace-store", () => workspaceMocks);

import CaseDetailPage from "@/app/app/cases/[id]/page";
import AppDashboardPage from "@/app/app/page";
import { CaseTaskList } from "@/components/case-task-list";

const researchCase = {
  id: "case-kill-switch",
  title: "Manual case work remains available",
  question: "Can the case still be managed without the guide?",
  status: "active" as const,
  focus: "Manual task planning",
  privacy: "private" as const,
  hypotheses: [],
  evidence: [],
  tasks: [
    {
      id: "task-manual",
      title: "Review the source",
      status: "todo" as const,
      updatedAt: "2026-07-13T18:00:00.000Z"
    }
  ]
};

beforeEach(() => {
  vi.resetAllMocks();
  configMocks.isGuidedResearchEnabled.mockReturnValue(false);
  authMocks.getSessionContext.mockResolvedValue({
    kind: "member",
    userId: "editor-kill-switch",
    email: "editor@example.test",
    name: "Case Editor",
    role: "editor",
    archiveId: "archive-kill-switch"
  });
  workspaceMocks.readWorkspace.mockResolvedValue({
    archiveName: "Test archive",
    cases: [researchCase],
    dnaMatches: []
  });
  dashboardMocks.buildDashboardSummary.mockReturnValue({
    metrics: {
      people: 0,
      sourceReferences: 0,
      sourceDocuments: 0,
      dnaMatches: 0,
      triagedDnaMatches: 0,
      activeCases: 1,
      highPriorityDnaMatches: 0
    },
    caseRows: [],
    actions: [],
    dnaLeads: []
  });
});

describe("guided research kill switch", () => {
  it("does not invoke the guide engine while the dashboard feature is disabled", async () => {
    await AppDashboardPage();

    expect(guideMocks.buildResearchGuide).not.toHaveBeenCalled();
    expect(workspaceMocks.readWorkspace).toHaveBeenCalledWith({
      archiveId: "archive-kill-switch"
    });
  });

  it("keeps the manual task workspace on a disabled case page", async () => {
    const page = await CaseDetailPage({ params: Promise.resolve({ id: researchCase.id }) });
    const manualTasks = findElementByType(page, CaseTaskList);

    expect(manualTasks).toBeDefined();
    expect(manualTasks?.props).toMatchObject({
      caseId: researchCase.id,
      initialTasks: researchCase.tasks,
      canWrite: true,
      allowManualCompletion: true
    });
    expect(workspaceMocks.readWorkspace).toHaveBeenCalledWith({
      archiveId: "archive-kill-switch"
    });
  });
});

function findElementByType(
  node: ReactNode,
  type: ElementType
): ReactElement<{ children?: ReactNode; [key: string]: unknown }> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElementByType(child, type);
      if (match) return match;
    }
    return undefined;
  }
  if (!isValidElement(node)) {
    return undefined;
  }

  const element = node as ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
  if (element.type === type) {
    return element;
  }
  return findElementByType(element.props.children, type);
}
