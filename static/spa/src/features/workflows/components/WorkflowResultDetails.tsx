import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, Circle, Copy, Crosshair, Download, Files, GitBranch, History, PencilLine, RefreshCw, RotateCcw, Save, SendHorizontal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { MarkdownRichEditor } from "./MarkdownRichEditor";

import type { WorkflowArtifactFormat, WorkflowEditSaveMode, WorkflowArtifactSummary, WorkflowResult, WorkflowRun, WorkflowRunVersion, WorkflowSelection, WorkflowSuggestedAction } from "../types";

type SourceFileMeta = {
  file_id?: string;
  name?: string;
  folder_path?: string | null;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function formatSourceLabel(source: SourceFileMeta) {
  const base = String(source.name || source.file_id || "Source file").replace(" — retrieved evidence", "").trim();
  return source.folder_path ? `${base} · ${source.folder_path}` : base;
}

function sourceIdentity(source: SourceFileMeta) {
  return String(source.file_id || source.name || "").trim();
}

function uniqueSourceFiles(sources: SourceFileMeta[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = sourceIdentity(source);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function versionKindLabel(version: WorkflowRunVersion) {
  if (version.kind === "original") return "Original";
  if (version.kind === "branch") return "Branch";
  if (version.kind === "edit") return "Edited";
  return "Refined";
}

function versionLabel(version: WorkflowRunVersion) {
  return `V${version.version_number || 1}`;
}

function sortedVersions(versions: WorkflowRunVersion[]) {
  return [...(versions || [])].sort((a, b) => (a.version_number || 0) - (b.version_number || 0));
}

function versionDepth(version: WorkflowRunVersion, versions: WorkflowRunVersion[]) {
  const byId = new Map(versions.map((item) => [item.id, item]));
  let depth = 0;
  let cursor = version.parent_version_id || "";
  const seen = new Set<string>();
  while (cursor && byId.has(cursor) && !seen.has(cursor) && depth < 8) {
    seen.add(cursor);
    depth += 1;
    cursor = byId.get(cursor)?.parent_version_id || "";
  }
  return depth;
}

function stripSourcesUsedSection(markdown: string) {
  return String(markdown || "")
    .replace(/^\s*#{1,6}\s+(?:sources used|source used|sources|source material)\s*$[\s\S]*?(?=^\s*#{1,6}\s+|\s*$)/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fallbackMarkdown(result: WorkflowResult) {
  const lines: string[] = [];
  const summary = String(result.summary || "").trim();
  if (summary) lines.push(summary);

  const bullets = (result.bullets || []).map((item) => String(item || "").trim()).filter(Boolean);
  if (bullets.length) {
    lines.push("", "## Summary", ...bullets.map((item) => `- ${item}`));
  }

  const actions = (result.next_actions || []).map((item) => String(item || "").trim()).filter(Boolean);
  if (actions.length) {
    lines.push("", "## Next steps", ...actions.map((item) => `- ${item}`));
  }

  return lines.join("\n").trim() || "No workflow output is available yet.";
}

function documentMarkdown(result: WorkflowResult) {
  return stripSourcesUsedSection(result.preview_markdown || fallbackMarkdown(result));
}

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof Files; children: ReactNode }) {
  return (
    <section className="border-t border-border/70 pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
        {Icon ? <Icon className="h-3 w-3" /> : null}
        {title}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

type Props = {
  result: WorkflowResult;
  selection?: WorkflowSelection;
  sourceRun?: WorkflowRun;
  artifact?: WorkflowArtifactSummary | null;
  artifactBusy?: boolean;
  refineBusy?: boolean;
  versions?: WorkflowRunVersion[];
  activeVersionId?: string | null;
  versionBusyId?: string | null;
  onSaveArtifact?: () => void;
  onSaveEditedOutput?: (content: string, mode: WorkflowEditSaveMode) => void | Promise<void>;
  onDownloadArtifact?: (format: WorkflowArtifactFormat) => void;
  onSelectVersion?: (version: WorkflowRunVersion) => void;
  onRenameVersion?: (version: WorkflowRunVersion, label: string) => void | Promise<void>;
  onMoveVersion?: (version: WorkflowRunVersion, position: { x: number; y: number }) => void | Promise<void>;
  onResetVersionLayout?: () => void | Promise<void>;
  onDownloadVersion?: (version: WorkflowRunVersion, format: WorkflowArtifactFormat) => void;
  onBranchVersion?: (version: WorkflowRunVersion) => void;
  onRefine?: (prompt: string) => void;
  onWorkflowAction?: (action: WorkflowSuggestedAction, selection: WorkflowSelection, sourceRun: WorkflowRun) => void;
};

const DOWNLOAD_FORMATS: Array<{ value: WorkflowArtifactFormat; label: string; helper: string }> = [
  { value: "markdown", label: "Markdown (.md)", helper: "Best for editing or reusing later." },
  { value: "txt", label: "Text (.txt)", helper: "Plain text for quick sharing." },
  { value: "docx", label: "Word (.docx)", helper: "Formatted document for Word or Google Docs." },
  { value: "pdf", label: "PDF (.pdf)", helper: "Polished file for sharing." },
];

type VersionHistoryPanelProps = {
  versions: WorkflowRunVersion[];
  activeVersionId?: string | null;
  versionBusyId?: string | null;
  onSelectVersion?: (version: WorkflowRunVersion) => void;
  onRenameVersion?: (version: WorkflowRunVersion, label: string) => void | Promise<void>;
  onMoveVersion?: (version: WorkflowRunVersion, position: { x: number; y: number }) => void | Promise<void>;
  onResetVersionLayout?: () => void | Promise<void>;
};

type VersionNodePosition = { x: number; y: number };

type VersionGraphNode = {
  version: WorkflowRunVersion;
  row: number;
  depth: number;
  x: number;
  y: number;
};

function versionDisplayName(version: WorkflowRunVersion) {
  return String(version.title || version.prompt || `${versionKindLabel(version)} output`).trim();
}

function versionMapLabel(version: WorkflowRunVersion) {
  return String(version.label || versionLabel(version)).trim();
}

function savedVersionPosition(version: WorkflowRunVersion): VersionNodePosition | null {
  if (version.layout_x == null || version.layout_y == null) {
    return null;
  }

  const x = Number(version.layout_x);
  const y = Number(version.layout_y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function VersionHistoryPanel({
  versions,
  activeVersionId,
  versionBusyId,
  onSelectVersion,
  onRenameVersion,
  onMoveVersion,
  onResetVersionLayout,
}: VersionHistoryPanelProps) {
  const [treeOpen, setTreeOpen] = useState(false);
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [versionLabelDraft, setVersionLabelDraft] = useState("");
  const [localNodePositions, setLocalNodePositions] = useState<Record<string, VersionNodePosition>>({});
  const [draggingVersionId, setDraggingVersionId] = useState<string | null>(null);
  const [resettingLayout, setResettingLayout] = useState(false);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panDragRef = useRef({ active: false, lastX: 0, lastY: 0 });
  const graphOriginRef = useRef({ x: 0, y: 0 });
  const treeWasOpenRef = useRef(false);
  const nodeDragRef = useRef<{
    active: boolean;
    versionId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startWorldX: number;
    startWorldY: number;
    originalSavedPosition: VersionNodePosition | null;
    moved: boolean;
  }>({
    active: false,
    versionId: "",
    pointerId: 0,
    startClientX: 0,
    startClientY: 0,
    startWorldX: 0,
    startWorldY: 0,
    originalSavedPosition: null,
    moved: false,
  });

  const orderedVersions = useMemo(() => sortedVersions(versions), [versions]);
  const activeVersion = orderedVersions.find((version) => version.id === activeVersionId) || orderedVersions[orderedVersions.length - 1];
  const activeVersionRef = useRef<WorkflowRunVersion | undefined>(activeVersion);
  const hasMultipleVersions = orderedVersions.length > 1;

  const graphColumnGap = 112;
  const graphRowGap = 92;
  const graphPaddingX = 1200;
  const graphPaddingY = 900;

  const graphNodes = useMemo<VersionGraphNode[]>(() => {
    return orderedVersions.map((version, row) => {
      const depth = Math.min(versionDepth(version, orderedVersions), 6);
      const autoPosition = {
        x: depth * graphColumnGap,
        y: row * graphRowGap,
      };
      const position = localNodePositions[version.id] || savedVersionPosition(version) || autoPosition;
      return {
        version,
        row,
        depth,
        x: position.x,
        y: position.y,
      };
    });
  }, [graphColumnGap, graphRowGap, localNodePositions, orderedVersions]);

  const graphNodeById = useMemo(() => new Map(graphNodes.map((node) => [node.version.id, node])), [graphNodes]);

  const graphBounds = useMemo(() => {
    if (!graphNodes.length) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
    return graphNodes.reduce(
      (bounds, node) => ({
        minX: Math.min(bounds.minX, node.x),
        maxX: Math.max(bounds.maxX, node.x),
        minY: Math.min(bounds.minY, node.y),
        maxY: Math.max(bounds.maxY, node.y),
      }),
      { minX: graphNodes[0].x, maxX: graphNodes[0].x, minY: graphNodes[0].y, maxY: graphNodes[0].y }
    );
  }, [graphNodes]);

  const computedGraphOriginX = graphPaddingX - graphBounds.minX;
  const computedGraphOriginY = graphPaddingY - graphBounds.minY;

  useEffect(() => {
    if (!draggingVersionId) {
      graphOriginRef.current = { x: computedGraphOriginX, y: computedGraphOriginY };
    }
  }, [computedGraphOriginX, computedGraphOriginY, draggingVersionId]);

  const graphOriginX = draggingVersionId ? graphOriginRef.current.x : computedGraphOriginX;
  const graphOriginY = draggingVersionId ? graphOriginRef.current.y : computedGraphOriginY;
  const renderedGraphOriginRef = useRef({ x: graphOriginX, y: graphOriginY });
  const graphWidth = Math.max(3400, graphBounds.maxX - graphBounds.minX + graphPaddingX * 2);
  const graphHeight = Math.max(2400, graphBounds.maxY - graphBounds.minY + graphPaddingY * 2);

  useLayoutEffect(() => {
    const previousOrigin = renderedGraphOriginRef.current;
    const nextOrigin = { x: graphOriginX, y: graphOriginY };
    if (previousOrigin.x === nextOrigin.x && previousOrigin.y === nextOrigin.y) return;

    if (treeOpen && treeWasOpenRef.current) {
      setPanOffset((current) => ({
        x: current.x + previousOrigin.x - nextOrigin.x,
        y: current.y + previousOrigin.y - nextOrigin.y,
      }));
    }

    renderedGraphOriginRef.current = nextOrigin;
  }, [graphOriginX, graphOriginY, treeOpen]);

  const getNodePosition = useCallback((node: VersionGraphNode) => ({
    x: graphOriginX + node.x,
    y: graphOriginY + node.y,
  }), [graphOriginX, graphOriginY]);

  const centerVersion = useCallback((version = activeVersion) => {
    if (!version || !viewportRef.current) return;

    const node = graphNodeById.get(version.id);
    if (!node) return;

    const { x, y } = getNodePosition(node);
    setPanOffset({
      x: viewportRef.current.clientWidth / 2 - x,
      y: viewportRef.current.clientHeight / 2 - y,
    });
  }, [activeVersion, getNodePosition, graphNodeById]);
  const centerVersionRef = useRef(centerVersion);

  useEffect(() => {
    activeVersionRef.current = activeVersion;
  }, [activeVersion]);

  useEffect(() => {
    centerVersionRef.current = centerVersion;
  }, [centerVersion]);

  useEffect(() => {
    if (!treeOpen) {
      treeWasOpenRef.current = false;
      return undefined;
    }

    if (treeWasOpenRef.current) return undefined;

    treeWasOpenRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      centerVersionRef.current(activeVersionRef.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [treeOpen]);

  useEffect(() => {
    if (!editingVersionId) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editingVersionId]);

  const beginLabelEdit = (version: WorkflowRunVersion) => {
    setEditingVersionId(version.id);
    setVersionLabelDraft(versionMapLabel(version));
  };

  const cancelLabelEdit = () => {
    setEditingVersionId(null);
    setVersionLabelDraft("");
  };

  const saveLabelEdit = async (version: WorkflowRunVersion) => {
    const nextLabel = versionLabelDraft.trim();
    const currentLabel = versionMapLabel(version);

    if (!nextLabel || nextLabel === currentLabel) {
      cancelLabelEdit();
      return;
    }

    await onRenameVersion?.(version, nextLabel);
    cancelLabelEdit();
  };

  const handleLabelKeyDown = (event: KeyboardEvent<HTMLInputElement>, version: WorkflowRunVersion) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveLabelEdit(version);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelLabelEdit();
    }
  };

  const openVersion = (version: WorkflowRunVersion) => {
    if (version.id !== activeVersion?.id) {
      onSelectVersion?.(version);
    }
    setTreeOpen(false);
  };

  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    if (target?.closest?.("[data-version-map-node]")) return;

    panDragRef.current = { active: true, lastX: event.clientX, lastY: event.clientY };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    if (!panDragRef.current.active) return;

    const deltaX = event.clientX - panDragRef.current.lastX;
    const deltaY = event.clientY - panDragRef.current.lastY;
    panDragRef.current.lastX = event.clientX;
    panDragRef.current.lastY = event.clientY;
    setPanOffset((current) => ({ x: current.x + deltaX, y: current.y + deltaY }));
  };

  const stopPan = (event: PointerEvent<HTMLDivElement>) => {
    if (!panDragRef.current.active) return;

    panDragRef.current.active = false;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const startNodeDrag = (event: PointerEvent<HTMLButtonElement>, node: VersionGraphNode) => {
    if (versionBusyId === node.version.id || editingVersionId === node.version.id) return;

    event.preventDefault();
    event.stopPropagation();
    nodeDragRef.current = {
      active: true,
      versionId: node.version.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorldX: node.x,
      startWorldY: node.y,
      originalSavedPosition: savedVersionPosition(node.version),
      moved: false,
    };
    setDraggingVersionId(node.version.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveNodeDrag = (event: PointerEvent<HTMLButtonElement>, node: VersionGraphNode) => {
    const drag = nodeDragRef.current;
    if (!drag.active || drag.versionId !== node.version.id) return;

    event.preventDefault();
    event.stopPropagation();
    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) > 4) {
      nodeDragRef.current.moved = true;
    }
    if (!nodeDragRef.current.moved) return;

    const nextPosition = {
      x: drag.startWorldX + deltaX,
      y: drag.startWorldY + deltaY,
    };
    setLocalNodePositions((current) => ({ ...current, [node.version.id]: nextPosition }));
  };

  const stopNodeDrag = async (event: PointerEvent<HTMLButtonElement>, node: VersionGraphNode) => {
    const drag = nodeDragRef.current;
    if (!drag.active || drag.versionId !== node.version.id) return;

    event.preventDefault();
    event.stopPropagation();
    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    const moved = drag.moved || Math.hypot(deltaX, deltaY) > 4;
    const nextPosition = {
      x: drag.startWorldX + deltaX,
      y: drag.startWorldY + deltaY,
    };
    nodeDragRef.current.active = false;
    setDraggingVersionId(null);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!moved) {
      openVersion(node.version);
      return;
    }

    setLocalNodePositions((current) => ({ ...current, [node.version.id]: nextPosition }));
    try {
      await onMoveVersion?.(node.version, nextPosition);
    } catch {
      setLocalNodePositions((current) => {
        const next = { ...current };
        if (drag.originalSavedPosition) {
          next[node.version.id] = drag.originalSavedPosition;
        } else {
          delete next[node.version.id];
        }
        return next;
      });
    }
  };

  const cancelNodeDrag = (event: PointerEvent<HTMLButtonElement>, node: VersionGraphNode) => {
    const drag = nodeDragRef.current;
    if (!drag.active || drag.versionId !== node.version.id) return;

    nodeDragRef.current.active = false;
    setDraggingVersionId(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setLocalNodePositions((current) => {
      const next = { ...current };
      if (drag.originalSavedPosition) {
        next[node.version.id] = drag.originalSavedPosition;
      } else {
        delete next[node.version.id];
      }
      return next;
    });
  };

  const resetLayout = async () => {
    if (!onResetVersionLayout || resettingLayout) return;
    setResettingLayout(true);
    setLocalNodePositions({});
    try {
      await onResetVersionLayout();
    } finally {
      setResettingLayout(false);
    }
  };

  if (!hasMultipleVersions) return null;

  return (
    <>
      <div className="rounded-2xl border border-border/70 bg-muted/10 px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium leading-5 text-foreground">
              <History className="h-4 w-4 text-muted-foreground" />
              Versions
              {activeVersion ? (
                <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px] font-normal">
                  Viewing {versionMapLabel(activeVersion)}
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              Pick a saved output from the dropdown or use the map to jump between versions.
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto lg:justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-9 w-full justify-between rounded-full px-3 text-xs sm:w-[230px]">
                  <span className="truncate text-left">
                    {activeVersion ? `Viewing ${versionMapLabel(activeVersion)} · ${versionKindLabel(activeVersion)}` : "Choose version"}
                  </span>
                  <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[360px] w-[320px] overflow-y-auto rounded-2xl p-2">
                <DropdownMenuLabel className="px-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">Saved outputs</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {orderedVersions.map((version) => {
                  const active = version.id === activeVersion?.id;
                  const busy = versionBusyId === version.id;
                  return (
                    <DropdownMenuItem
                      key={version.id}
                      disabled={busy}
                      className="items-start gap-2 rounded-xl px-2 py-2"
                      onSelect={(event) => {
                        if (active) {
                          event.preventDefault();
                          return;
                        }
                        onSelectVersion?.(version);
                      }}
                    >
                      <div className="pt-0.5">
                        {active ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium leading-5 text-foreground">{versionMapLabel(version)}</span>
                          <span className="text-xs leading-5 text-muted-foreground">{versionKindLabel(version)}</span>
                          {active ? <span className="ml-auto text-[11px] text-primary">Current</span> : null}
                        </div>
                        <div className="truncate text-[11px] leading-4 text-muted-foreground">
                          {versionDisplayName(version)}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 w-full rounded-full px-3 text-xs sm:w-auto"
              onClick={() => setTreeOpen(true)}
            >
              <GitBranch className="mr-1 h-4 w-4" />
              Open map
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={treeOpen} onOpenChange={setTreeOpen}>
        <DialogContent className="flex max-h-[96vh] w-[98vw] max-w-[1800px] flex-col overflow-hidden rounded-3xl border-border p-0 shadow-[0_32px_90px_rgba(15,23,42,0.22)]">
          <DialogTitle className="sr-only">Version map</DialogTitle>

          <div
            ref={viewportRef}
            className={cn(
              "relative h-[92vh] min-h-[620px] flex-1 overflow-hidden bg-muted/10 select-none touch-none",
              isPanning ? "cursor-grabbing" : "cursor-grab"
            )}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={stopPan}
            onPointerCancel={stopPan}
          >
            <div
              className="absolute left-0 top-0 will-change-transform"
              style={{ width: graphWidth, height: graphHeight, transform: `translate(${panOffset.x}px, ${panOffset.y}px)` }}
            >
              <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
                {graphNodes.map((node) => {
                  if (!node.version.parent_version_id) return null;
                  const parent = graphNodeById.get(node.version.parent_version_id);
                  if (!parent) return null;
                  const { x: x1, y: y1 } = getNodePosition(parent);
                  const { x: x2, y: y2 } = getNodePosition(node);
                  const midX = x1 + Math.max(28, (x2 - x1) / 2);
                  return (
                    <path
                      key={`${node.version.id}-line`}
                      d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                      className="fill-none stroke-border"
                      strokeWidth="1.5"
                    />
                  );
                })}
              </svg>

              {graphNodes.map((node) => {
                const active = node.version.id === activeVersion?.id;
                const busy = versionBusyId === node.version.id;
                const dragging = draggingVersionId === node.version.id;
                const { x, y } = getNodePosition(node);
                return (
                  <div
                    key={node.version.id}
                    data-version-map-node
                    className="absolute"
                    style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
                      {editingVersionId === node.version.id ? (
                        <Input
                          ref={editInputRef}
                          value={versionLabelDraft}
                          maxLength={120}
                          disabled={busy}
                          onChange={(event) => setVersionLabelDraft(event.target.value)}
                          onBlur={() => { void saveLabelEdit(node.version); }}
                          onKeyDown={(event) => handleLabelKeyDown(event, node.version)}
                          onClick={(event) => event.stopPropagation()}
                          onPointerDown={(event) => event.stopPropagation()}
                          className="h-auto w-32 rounded-xl border-border bg-background/95 px-2 py-1 text-center text-[11px] font-medium leading-4 shadow-lg"
                        />
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              disabled={busy || dragging}
                              onClick={(event) => {
                                event.stopPropagation();
                                beginLabelEdit(node.version);
                              }}
                              onPointerDown={(event) => event.stopPropagation()}
                              className={cn(
                                "min-w-[2.75rem] max-w-[120px] rounded-xl border border-border/70 bg-background/95 px-2 py-1 text-center text-[11px] font-medium leading-4 text-foreground shadow-sm transition hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70",
                                active && "border-primary/40 bg-primary/10 text-primary"
                              )}
                              style={{
                                display: "-webkit-box",
                                WebkitBoxOrient: "vertical",
                                WebkitLineClamp: 3,
                                overflow: "hidden",
                                overflowWrap: "break-word",
                                wordBreak: "normal",
                              }}
                            >
                              {versionMapLabel(node.version)}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" sideOffset={8} className="max-w-[240px] rounded-xl px-3 py-2 text-xs shadow-lg">
                            <div
                              className="font-medium leading-5"
                              style={{
                                display: "-webkit-box",
                                WebkitBoxOrient: "vertical",
                                WebkitLineClamp: 3,
                                overflow: "hidden",
                                wordBreak: "break-word",
                              }}
                            >
                              {versionMapLabel(node.version)}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${versionMapLabel(node.version)} ${versionDisplayName(node.version)}`}
                          aria-current={active ? "true" : undefined}
                          disabled={busy}
                          onPointerDown={(event) => startNodeDrag(event, node)}
                          onPointerMove={(event) => moveNodeDrag(event, node)}
                          onPointerUp={(event) => { void stopNodeDrag(event, node); }}
                          onPointerCancel={(event) => cancelNodeDrag(event, node)}
                          className={cn(
                            "group relative grid h-6 w-6 cursor-grab place-items-center rounded-full border bg-background shadow-sm transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:cursor-grabbing disabled:cursor-wait disabled:opacity-70",
                            active ? "border-primary bg-primary/10 ring-4 ring-primary/15" : "border-border hover:border-primary/50",
                            dragging && "scale-110 cursor-grabbing border-primary shadow-lg ring-4 ring-primary/10"
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full bg-muted-foreground/45 transition-colors group-hover:bg-primary",
                              node.version.kind === "branch" && "h-2 w-2",
                              active && "bg-primary"
                            )}
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" sideOffset={8} className="max-w-[240px] rounded-xl px-3 py-2 text-xs shadow-lg">
                        <div
                          className="font-medium leading-5"
                          style={{
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical",
                            WebkitLineClamp: 3,
                            overflow: "hidden",
                            wordBreak: "break-word",
                          }}
                        >
                          {versionMapLabel(node.version)}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
            </div>

            <div
              className="absolute bottom-5 right-5 z-20 flex flex-col gap-2 sm:flex-row"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="h-11 w-11 rounded-full border border-border/70 bg-background/95 shadow-lg backdrop-blur transition hover:scale-105"
                    aria-label="Center current version"
                    onClick={() => centerVersion()}
                  >
                    <Crosshair className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={8} className="rounded-xl px-3 py-2 text-xs shadow-lg">
                  Center current
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="h-11 w-11 rounded-full border border-border/70 bg-background/95 shadow-lg backdrop-blur transition hover:scale-105 disabled:opacity-60"
                    aria-label={resettingLayout ? "Resetting version map layout" : "Reset version map layout"}
                    disabled={!onResetVersionLayout || resettingLayout}
                    onClick={() => { void resetLayout(); }}
                  >
                    <RefreshCw className={cn("h-4 w-4", resettingLayout && "animate-spin")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={8} className="rounded-xl px-3 py-2 text-xs shadow-lg">
                  {resettingLayout ? "Resetting" : "Reset layout"}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function WorkflowResultDetails({
  result,
  selection,
  sourceRun,
  artifact,
  artifactBusy = false,
  refineBusy = false,
  versions = [],
  activeVersionId,
  versionBusyId = null,
  onSaveArtifact,
  onSaveEditedOutput,
  onDownloadArtifact,
  onSelectVersion,
  onRenameVersion,
  onMoveVersion,
  onResetVersionLayout,
  onRefine,
  onWorkflowAction,
}: Props) {
  const rawSourceFiles = asArray<SourceFileMeta>(result.metadata?.source_files);
  const visibleSourceFiles = useMemo(() => uniqueSourceFiles(rawSourceFiles), [rawSourceFiles]);
  const markdown = useMemo(() => documentMarkdown(result), [result]);
  const [editingOutput, setEditingOutput] = useState(false);
  const [draftMarkdown, setDraftMarkdown] = useState(markdown);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setDraftMarkdown(markdown);
    setEditingOutput(false);
    setCopied(false);
  }, [activeVersionId, markdown]);

  const outputMarkdown = editingOutput ? draftMarkdown : markdown;
  const hasEditedOutput = draftMarkdown !== markdown;
  const canSaveEditedOutput = !!onSaveEditedOutput && hasEditedOutput && !!draftMarkdown.trim() && !artifactBusy;

  const suggestedActions = useMemo(() => {
    return asArray<WorkflowSuggestedAction>(result.metadata?.suggested_actions)
      .map((action) => ({
        kind: String(action.kind || "workflow").trim(),
        label: String(action.label || "").trim(),
        workflow_id: String(action.workflow_id || "").trim(),
        focus: String(action.focus || "").trim(),
        description: String(action.description || "").trim(),
      }))
      .filter((action) => action.label && action.workflow_id);
  }, [result.metadata]);

  const submitRefinement = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = refinePrompt.trim();
    if (!prompt || refineBusy) return;
    onRefine?.(prompt);
    setRefinePrompt("");
  };

  const copyOutput = async () => {
    await navigator.clipboard.writeText(outputMarkdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const cancelOutputEdit = () => {
    setDraftMarkdown(markdown);
    setEditingOutput(false);
  };

  const beginOutputEdit = () => {
    setDraftMarkdown(markdown);
    setEditingOutput(true);
  };

  const saveEditedOutput = async (mode: WorkflowEditSaveMode) => {
    if (!canSaveEditedOutput) return;
    await onSaveEditedOutput?.(draftMarkdown, mode);
    setEditingOutput(false);
  };

  return (
    <div className="space-y-5">
      <VersionHistoryPanel
        versions={versions}
        activeVersionId={activeVersionId}
        versionBusyId={versionBusyId}
        onSelectVersion={onSelectVersion}
        onRenameVersion={onRenameVersion}
        onMoveVersion={onMoveVersion}
        onResetVersionLayout={onResetVersionLayout}
      />

      <div className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-background shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border/70 bg-muted/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-end md:px-5">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            {editingOutput ? (
              <>
                <Button variant="ghost" size="sm" className="h-8 w-full rounded-full px-3 text-xs sm:w-auto" onClick={cancelOutputEdit} disabled={artifactBusy}>
                  <RotateCcw className="mr-1 h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-full rounded-full px-3 text-xs sm:w-auto"
                  onClick={() => { void saveEditedOutput("overwrite"); }}
                  disabled={!canSaveEditedOutput}
                >
                  <Save className="mr-1 h-4 w-4" />
                  {artifactBusy ? "Saving" : "Overwrite"}
                </Button>
                <Button
                  size="sm"
                  className="h-8 w-full rounded-full px-3 text-xs sm:w-auto"
                  onClick={() => { void saveEditedOutput("new_version"); }}
                  disabled={!canSaveEditedOutput}
                >
                  <GitBranch className="mr-1 h-4 w-4" />
                  {artifactBusy ? "Saving" : "Save as new version"}
                </Button>
              </>
            ) : (
              <>
                {onSaveEditedOutput ? (
                  <Button variant="outline" size="sm" className="h-8 w-full rounded-full px-3 text-xs sm:w-auto" onClick={beginOutputEdit} disabled={artifactBusy}>
                    <PencilLine className="mr-1 h-4 w-4" />
                    Edit
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" className="h-8 w-full rounded-full px-3 text-xs sm:w-auto" onClick={() => { void copyOutput(); }}>
                  <Copy className="mr-1 h-4 w-4" />
                  {copied ? "Copied" : "Copy"}
                </Button>
                {!artifact && onSaveArtifact ? (
                  <Button variant="outline" size="sm" className="h-8 w-full rounded-full px-3 text-xs sm:w-auto" onClick={onSaveArtifact} disabled={artifactBusy}>
                    <Save className="mr-1 h-4 w-4" />
                    Save
                  </Button>
                ) : null}
                {onDownloadArtifact ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" className="h-8 w-full rounded-full px-3 text-xs sm:w-auto" disabled={artifactBusy}>
                        <Download className="mr-1 h-4 w-4" />
                        {artifact ? "Download" : "Save and download"}
                        <ChevronDown className="ml-1 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64 rounded-2xl">
                      <DropdownMenuLabel className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Download format</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {DOWNLOAD_FORMATS.map((item) => (
                        <DropdownMenuItem
                          key={item.value}
                          className="items-start rounded-xl px-2 py-2"
                          onSelect={() => onDownloadArtifact(item.value)}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium leading-5 text-foreground">{item.label}</div>
                            <div className="text-[11px] leading-4 text-muted-foreground">{item.helper}</div>
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </>
            )}
          </div>
        </div>
        {editingOutput ? (
          <MarkdownRichEditor
            value={draftMarkdown}
            onChange={setDraftMarkdown}
            disabled={artifactBusy}
            ariaLabel="Edit workflow output"
          />
        ) : (
          <article className="px-5 py-6 md:px-8 md:py-8">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h1 className="mb-5 text-2xl font-semibold leading-tight tracking-[-0.02em] text-foreground">{children}</h1>,
                h2: ({ children }) => <h2 className="mb-3 mt-7 text-lg font-semibold leading-7 text-foreground first:mt-0">{children}</h2>,
                h3: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold leading-6 text-foreground">{children}</h3>,
                h4: ({ children }) => <h4 className="mb-2 mt-5 text-[15px] font-semibold leading-6 text-foreground">{children}</h4>,
                h5: ({ children }) => <h5 className="mb-2 mt-4 text-sm font-semibold leading-6 text-foreground">{children}</h5>,
                h6: ({ children }) => <h6 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{children}</h6>,
                p: ({ children }) => <p className="my-3 text-[15px] leading-7 text-foreground/90">{children}</p>,
                ul: ({ children }) => <ul className="my-3 ml-5 list-disc space-y-2 text-[15px] leading-7 text-foreground/90">{children}</ul>,
                ol: ({ children }) => <ol className="my-3 ml-5 list-decimal space-y-2 text-[15px] leading-7 text-foreground/90">{children}</ol>,
                li: ({ children }) => <li className="pl-1">{children}</li>,
                blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-border pl-4 text-[15px] leading-7 text-muted-foreground">{children}</blockquote>,
                strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                table: ({ children }) => <div className="my-5 overflow-x-auto rounded-2xl border border-border/70"><table className="w-full min-w-[560px] border-collapse text-sm">{children}</table></div>,
                th: ({ children }) => <th className="border-b border-border/70 bg-muted/30 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{children}</th>,
                td: ({ children }) => <td className="border-t border-border/70 px-3 py-2 align-top text-sm leading-6 text-foreground/90">{children}</td>,
                code: ({ children, className }) => (
                  <code className={cn("rounded-md bg-muted px-1.5 py-0.5 text-[0.9em]", className)}>{children}</code>
                ),
                pre: ({ children }) => <pre className="my-4 overflow-x-auto rounded-2xl bg-muted px-4 py-3 text-sm leading-6">{children}</pre>,
              }}
            >
              {markdown}
            </ReactMarkdown>
          </article>
        )}
      </div>

      {onRefine ? (
        <form onSubmit={submitRefinement} className="rounded-2xl border border-border/70 bg-background px-4 py-4 shadow-sm">
          <label htmlFor="workflow-refine-prompt" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
            Refine output
          </label>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <Textarea
              id="workflow-refine-prompt"
              value={refinePrompt}
              onChange={(event) => setRefinePrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Ask for a revision. The new output will be saved as another version."
              className="min-h-[88px] flex-1 rounded-2xl resize-none"
              disabled={refineBusy}
            />
            <Button type="submit" className="h-10 rounded-full px-4" disabled={refineBusy || !refinePrompt.trim()}>
              <SendHorizontal className="mr-2 h-4 w-4" />
              {refineBusy ? "Refining" : "Refine"}
            </Button>
          </div>
        </form>
      ) : null}

      {!!visibleSourceFiles.length && (
        <Section title="Sources used" icon={Files}>
          <div className="flex flex-wrap gap-1">
            {visibleSourceFiles.map((source, idx) => (
              <Badge
                key={`${source.file_id || source.name || "source"}-${idx}`}
                variant="secondary"
                className="max-w-full whitespace-normal rounded-full px-2 py-0.5 text-left text-[10px] font-normal"
              >
                {formatSourceLabel(source)}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      {!!suggestedActions.length && selection && sourceRun && onWorkflowAction && (
        <Section title="Continue from this output">
          <div className="grid gap-3 lg:grid-cols-2">
            {suggestedActions.map((action) => (
              <Button
                key={`${action.workflow_id}-${action.label}`}
                variant="outline"
                className="h-auto min-h-[92px] w-full items-start justify-start whitespace-normal rounded-2xl px-4 py-4 text-left"
                onClick={() => onWorkflowAction(action, selection, sourceRun)}
              >
                <div className="min-w-0 space-y-2">
                  <div className="text-base font-medium leading-6 break-words text-foreground">{action.label}</div>
                  {action.description ? (
                    <div className="text-sm leading-6 break-words text-muted-foreground">{action.description}</div>
                  ) : null}
                </div>
              </Button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
