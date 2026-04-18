import type { WorkflowRun } from "../types";
import { WorkflowRunCard } from "./WorkflowRunCard";

type Props = {
  runs: WorkflowRun[];
};

export function WorkflowRunShelf({ runs }: Props) {
  if (!runs.length) return null;

  return (
    <div className="border-b bg-background/80 px-3 py-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Recent workflow runs</div>
          <p className="text-xs text-muted-foreground">Shared result cards keep new workflows out of FilesPage and ChatPage churn.</p>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {runs.map((run) => (
          <WorkflowRunCard key={run.id} run={run} />
        ))}
      </div>
    </div>
  );
}
