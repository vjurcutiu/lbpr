import { UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyState({ onUploadClick }: { onUploadClick?: () => void }) {
  return (
    <div className="h-full w-full grid place-items-center">
      <div className="max-w-md w-full text-center border rounded-xl p-6 bg-muted/20">
        <div className="mx-auto h-12 w-12 grid place-items-center rounded-full bg-muted">
          <UploadCloud className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mt-3 text-base font-semibold">No file selected</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a file from the left—or upload new files to preview them here.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button size="sm" onClick={onUploadClick}>
            <UploadCloud className="h-4 w-4 mr-1.5" />
            Upload files
          </Button>
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">
          Tip: You can also drag & drop files anywhere on this page.
        </div>
      </div>
    </div>
  );
}
