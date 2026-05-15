import type { ChangeEventHandler, RefObject } from "react";
import { Activity, Folder, FolderPlus, Loader2, RefreshCw, Search, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { cn } from "@/lib/utils";

type Props = {
  uploading: boolean;
  busy: boolean;
  runningTasks: boolean;
  filter: string;
  inputRef: RefObject<HTMLInputElement | null>;
  transcribeInputRef: RefObject<HTMLInputElement | null>;
  ocrInputRef: RefObject<HTMLInputElement | null>;
  onOpenFolders: () => void;
  onUpload: () => void;
  onNewFolder: () => void;
  onChange: ChangeEventHandler<HTMLInputElement>;
  onPickTranscribeFile: ChangeEventHandler<HTMLInputElement>;
  onPickOcrFile: ChangeEventHandler<HTMLInputElement>;
  onFilterChange: (value: string) => void;
  onClearFilter: () => void;
  onRefresh: () => void;
  onToggleTransfers: () => void;
};

export function FilesTopBar({
  uploading,
  busy,
  runningTasks,
  filter,
  inputRef,
  transcribeInputRef,
  ocrInputRef,
  onOpenFolders,
  onUpload,
  onNewFolder,
  onChange,
  onPickTranscribeFile,
  onPickOcrFile,
  onFilterChange,
  onClearFilter,
  onRefresh,
  onToggleTransfers,
}: Props) {
  const hasActiveTasks = uploading || runningTasks;

  return (
    <div className="sticky top-0 z-10 border-b bg-background/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/65">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card/90 p-2 shadow-sm shadow-primary/5">
        <Button variant="outline" size="sm" className="md:hidden" onClick={onOpenFolders} title="Browse folders">
          <Folder className="h-4 w-4" />
          <span className="ml-1.5">Folders</span>
        </Button>

        <div className="flex items-center gap-2">
          <Button onClick={onUpload} disabled={uploading} size="sm" className="shadow-sm shadow-primary/15">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            <span className="ml-1.5">{uploading ? "Uploading…" : "Upload"}</span>
          </Button>

          <Button variant="outline" size="sm" onClick={onNewFolder} title="New folder" className="bg-background/70">
            <FolderPlus className="h-4 w-4" />
            <span className="ml-1.5 hidden sm:inline">New folder</span>
          </Button>
        </div>

        <Input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={onChange}
          multiple
          accept="image/*,audio/*,text/*,.txt,.md,.markdown,.csv,.json,.xml,.yaml,.yml,.pdf,.doc,.docx"
        />
        <Input ref={transcribeInputRef} type="file" accept="audio/*,video/*" className="hidden" onChange={onPickTranscribeFile} />
        <Input ref={ocrInputRef} type="file" accept="image/*" className="hidden" onChange={onPickOcrFile} />

        <div className="relative order-last w-full md:order-none md:mx-2 md:min-w-[18rem] md:max-w-xl md:flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search folders & files…"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            className="h-9 rounded-xl border-border/80 bg-background/80 pl-9 pr-8 shadow-inner shadow-primary/5"
          />
          {filter ? (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={onClearFilter}
              aria-label="Clear filter"
              title="Clear"
              type="button"
            >
              ×
            </button>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={onRefresh} disabled={busy} size="sm" className="bg-background/70">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 md:mr-1.5" />}
            <span className="hidden md:inline">Refresh</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onToggleTransfers}
            title="Show tasks"
            className={cn("relative bg-background/70", hasActiveTasks && "border-primary/40 bg-primary/10 text-primary")}
          >
            <Activity className="h-4 w-4" />
            <span className="ml-1 hidden sm:inline">Tasks</span>
            {hasActiveTasks && (
              <span className="absolute -right-1 -top-1 inline-flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
