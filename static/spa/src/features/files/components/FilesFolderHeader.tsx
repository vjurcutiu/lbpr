import { ArrowUp, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BreadcrumbItem = {
  label: string;
  path: string;
};

type Props = {
  selectedFolder: string;
  breadcrumb: BreadcrumbItem[];
  folderCount: number;
  fileCount: number;
  onGoUp: () => void;
  onSelectFolder: (path: string) => void;
};

export function FilesFolderHeader({
  selectedFolder,
  breadcrumb,
  folderCount,
  fileCount,
  onGoUp,
  onSelectFolder,
}: Props) {
  return (
    <div className="flex h-10 items-center gap-2 border-b bg-background px-3">
      <Button variant="ghost" size="sm" onClick={onGoUp} disabled={!selectedFolder} title="Up">
        <ArrowUp className="h-4 w-4" />
      </Button>
      <div className="min-w-0 flex items-center gap-1 text-sm">
        {breadcrumb.map((crumb, idx) => (
          <div key={crumb.path || "root"} className="flex min-w-0 items-center">
            <button
              className={cn(
                "max-w-[22vw] truncate hover:underline md:max-w-[18rem]",
                idx === breadcrumb.length - 1 && "font-medium"
              )}
              onClick={() => onSelectFolder(crumb.path)}
              title={crumb.path || "Root"}
              type="button"
            >
              {crumb.label}
            </button>
            {idx < breadcrumb.length - 1 ? <ChevronRight className="mx-1 h-4 w-4 opacity-60" /> : null}
          </div>
        ))}
      </div>
      <div className="flex-1" />
      <div className="hidden text-xs text-muted-foreground sm:block">
        {folderCount} folder{folderCount === 1 ? "" : "s"} • {fileCount} file{fileCount === 1 ? "" : "s"}
      </div>
    </div>
  );
}
