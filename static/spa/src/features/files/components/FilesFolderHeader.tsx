import { ArrowUp, ChevronRight, FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { fmtSize } from "../utils/formatters";

type BreadcrumbItem = {
  label: string;
  path: string;
};

type Props = {
  selectedFolder: string;
  breadcrumb: BreadcrumbItem[];
  folderCount: number;
  fileCount: number;
  totalSize: number;
  onGoUp: () => void;
  onSelectFolder: (path: string) => void;
};

export function FilesFolderHeader({
  selectedFolder,
  breadcrumb,
  folderCount,
  fileCount,
  totalSize,
  onGoUp,
  onSelectFolder,
}: Props) {
  const folderTitle = selectedFolder ? breadcrumb[breadcrumb.length - 1]?.label || selectedFolder : "Files";

  return (
    <div className="border-b bg-background/70 px-5 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/55">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {breadcrumb.map((crumb, idx) => (
              <div key={crumb.path || "root"} className="flex min-w-0 items-center">
                <button
                  className={cn(
                    "max-w-[32vw] truncate rounded-md px-1 py-0.5 hover:bg-primary/10 hover:text-foreground md:max-w-[18rem]",
                    idx === breadcrumb.length - 1 && "font-medium text-foreground"
                  )}
                  onClick={() => onSelectFolder(crumb.path)}
                  title={crumb.path || "Root"}
                  type="button"
                >
                  {crumb.label}
                </button>
                {idx < breadcrumb.length - 1 ? <ChevronRight className="mx-0.5 h-3.5 w-3.5 opacity-60" /> : null}
              </div>
            ))}
          </div>

          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-primary/15 bg-primary/10 text-primary shadow-sm shadow-primary/10">
              <FolderOpen className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">{folderTitle}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {folderCount} folder{folderCount === 1 ? "" : "s"} · {fileCount} file{fileCount === 1 ? "" : "s"} · {fmtSize(totalSize)}
              </p>
            </div>
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={onGoUp} disabled={!selectedFolder} title="Up" className="w-fit bg-card/80">
          <ArrowUp className="h-4 w-4" />
          <span className="ml-1.5">Up one level</span>
        </Button>
      </div>
    </div>
  );
}
