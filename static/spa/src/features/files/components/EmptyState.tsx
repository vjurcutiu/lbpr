import { Folder, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyState({
  onUploadClick,
  onBrowseClick,
}: {
  onUploadClick?: () => void;
  onBrowseClick?: () => void;
}) {
  return (
    <div className="h-full w-full grid place-items-center">
      <div className="max-w-md w-full text-center border rounded-xl p-6 bg-muted/20">
        <div className="mx-auto h-12 w-12 grid place-items-center rounded-full bg-muted">
          <UploadCloud className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mt-3 text-base font-semibold">No file selected</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a file from the explorer—or upload new files to preview them here.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {onBrowseClick && (
            <Button size="sm" variant="outline" onClick={onBrowseClick}>
              <Folder className="h-4 w-4 mr-1.5" />
              Browse files
            </Button>
          )}
          <Button size="sm" onClick={onUploadClick}>
            <UploadCloud className="h-4 w-4 mr-1.5" />
            Upload files
          </Button>
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground hidden sm:block">
          Tip: You can also drag & drop files anywhere on this page.
        </div>
      </div>
    </div>
  );
}
