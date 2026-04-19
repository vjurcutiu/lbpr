import type { ChangeEventHandler, RefObject } from "react";
import { Activity, Folder, FolderPlus, Loader2, RefreshCw, Search, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { fmtSize } from "../utils/formatters";

type Props = {
  selectedFolder: string;
  uploading: boolean;
  busy: boolean;
  runningTasks: boolean;
  filesCount: number;
  totalSize: number;
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
  selectedFolder,
  uploading,
  busy,
  runningTasks,
  filesCount,
  totalSize,
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
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <Button variant="outline" size="sm" className="md:hidden" onClick={onOpenFolders} title="Browse folders">
        <Folder className="h-4 w-4" />
        <span className="ml-1.5">Folders</span>
      </Button>

      <Button onClick={onUpload} disabled={uploading} size="sm" className="app-theme-action-button">
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        <span className="ml-1.5">{uploading ? "Uploading…" : "Upload"}</span>
      </Button>

      <Button variant="outline" size="sm" onClick={onNewFolder} title="New folder">
        <FolderPlus className="h-4 w-4" />
        <span className="ml-1.5 hidden sm:inline">New folder</span>
      </Button>

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

      <div className="relative order-last w-full md:order-none md:w-full md:max-w-sm">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search folders & files…"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          className="pl-8 pr-7"
        />
        {filter ? (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={onClearFilter}
            aria-label="Clear filter"
            title="Clear"
            type="button"
          >
            ×
          </button>
        ) : null}
      </div>

      <div className="hidden flex-1 md:block" />
      <div className="mr-2 hidden items-center text-xs text-muted-foreground md:flex">
        <span className="mr-3">{filesCount} file{filesCount === 1 ? "" : "s"}</span>
        <span>• {fmtSize(totalSize)}</span>
        {selectedFolder ? <span className="ml-3 truncate">• {selectedFolder}</span> : null}
      </div>

      <Button variant="outline" onClick={onRefresh} disabled={busy} size="sm">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 md:mr-1.5" />}
        <span className="hidden md:inline">Refresh</span>
      </Button>

      <Button variant="ghost" size="sm" onClick={onToggleTransfers} title="Show tasks" className="relative">
        <Activity className="h-4 w-4" />
        <span className="ml-1 hidden sm:inline">Tasks</span>
        {(uploading || runningTasks) && (
          <span className="absolute -right-1 -top-1 inline-flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
        )}
      </Button>
    </div>
  );
}
