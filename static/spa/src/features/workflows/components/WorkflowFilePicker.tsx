import { useMemo, useState } from "react";
import { Check, ChevronDown, FileText, FolderTree, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { FileItem } from "@/features/files/api";
import { basename, parentPath } from "@/features/files/utils/pageHelpers";

import type { WorkflowSelection } from "../types";

type Props = {
  files: FileItem[];
  selection: WorkflowSelection;
  loading?: boolean;
  disabled?: boolean;
  onSelectionChange: (selection: WorkflowSelection) => void;
};

function fileName(file: FileItem) {
  return basename(file.original_name || file.name || "") || file.original_name || file.name || "Untitled";
}

function fileFolder(file: FileItem) {
  return (file.folder_path || parentPath(file.name || "") || "").trim();
}

function nextSelection(files: FileItem[], current: WorkflowSelection, fileId: string): WorkflowSelection {
  const exists = current.file_ids.includes(fileId);
  const fileIds = exists
    ? current.file_ids.filter((id) => id !== fileId)
    : [...current.file_ids, fileId];

  const selectedFiles = fileIds
    .map((id) => files.find((item) => item.id === id))
    .filter((item): item is FileItem => !!item);
  const folderPaths = Array.from(
    new Set(
      selectedFiles
        .map((file) => fileFolder(file))
        .filter((value) => !!value)
    )
  );

  return {
    file_ids: fileIds,
    folder_paths: [],
    current_folder: folderPaths.length === 1 ? folderPaths[0] : "",
  };
}

export function WorkflowFilePicker({
  files,
  selection,
  loading = false,
  disabled = false,
  onSelectionChange,
}: Props) {
  const [open, setOpen] = useState(false);

  const filesById = useMemo(() => new Map(files.map((file) => [file.id, file] as const)), [files]);
  const selectedFiles = useMemo(
    () => selection.file_ids.map((id) => filesById.get(id)).filter((item): item is FileItem => !!item),
    [filesById, selection.file_ids]
  );

  const triggerLabel = loading
    ? "Loading files…"
    : selection.file_ids.length
      ? `${selection.file_ids.length} selected`
      : "Search files";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium">Source files</label>
        {selection.file_ids.length ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-full px-2 text-xs"
            onClick={() => onSelectionChange({ file_ids: [], folder_paths: [], current_folder: "" })}
            disabled={disabled || loading}
          >
            Clear all
          </Button>
        ) : null}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-10 w-full justify-between rounded-2xl border-border/80 bg-background px-3 font-normal"
            disabled={disabled || loading}
          >
            <span className="truncate text-left">{triggerLabel}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command shouldFilter>
            <CommandInput placeholder="Type a filename or folder…" />
            <CommandList>
              <CommandEmpty>
                {loading ? "Loading files…" : files.length ? "No matching files found." : "No files available yet."}
              </CommandEmpty>
              <CommandGroup heading={files.length ? `${files.length} files` : undefined}>
                {files.map((file) => {
                  const selected = selection.file_ids.includes(file.id);
                  const name = fileName(file);
                  const folder = fileFolder(file);
                  const searchValue = `${name} ${folder} ${file.name || ""}`.trim();
                  return (
                    <CommandItem
                      key={file.id}
                      value={searchValue}
                      onSelect={() => {
                        onSelectionChange(nextSelection(files, selection, file.id));
                      }}
                      className="items-start gap-3 px-3 py-2"
                    >
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/20">
                        <FileText className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium leading-5">{name}</div>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <FolderTree className="h-3 w-3" />
                          <span className="truncate">{folder || "Root"}</span>
                        </div>
                      </div>
                      <Check className={cn("mt-1 h-4 w-4 shrink-0", selected ? "opacity-100" : "opacity-0")} />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedFiles.length ? (
        <ScrollArea className="max-h-28 rounded-2xl border border-border/70 bg-muted/15 px-2 py-2">
          <div className="flex flex-wrap gap-2">
            {selectedFiles.map((file) => {
              const name = fileName(file);
              const folder = fileFolder(file);
              return (
                <Badge key={file.id} variant="outline" className="flex items-center gap-1 rounded-full py-1 pl-2 pr-1 font-normal">
                  <span className="max-w-[180px] truncate">{name}</span>
                  <span className="max-w-[140px] truncate text-[10px] text-muted-foreground">{folder || "Root"}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 rounded-full"
                    onClick={() => onSelectionChange(nextSelection(files, selection, file.id))}
                    disabled={disabled || loading}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              );
            })}
          </div>
        </ScrollArea>
      ) : (
        <div className="rounded-2xl border border-dashed border-border/80 px-3 py-2 text-xs text-muted-foreground">
          Search by filename, then add one or more files for this workflow.
        </div>
      )}
    </div>
  );
}
