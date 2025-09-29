#!/usr/bin/env python3
import argparse
import fnmatch
import hashlib
import json
import sys
from pathlib import Path
from typing import List, Tuple, Optional, Dict, Any, Iterable


# -------------------------
# Manifest parsing & helpers
# -------------------------

def _as_list(value: Optional[Any]) -> List[str]:
    """Normalize a string-or-list value to a list of strings."""
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list) and all(isinstance(x, str) for x in value):
        return value
    raise ValueError("Expected string or list of strings.")


def _filter_names(
    paths: Iterable[Path], include_glob: List[str], exclude_glob: List[str]
) -> List[Path]:
    """Filter file paths by include/exclude glob patterns against the filename (not the full path)."""
    def matches_any(name: str, patterns: List[str]) -> bool:
        return any(fnmatch.fnmatch(name, pat) for pat in patterns)

    result: List[Path] = []
    for p in paths:
        name = p.name
        # Include pass
        if include_glob:
            if not matches_any(name, include_glob):
                continue
        # Exclude pass
        if exclude_glob:
            if matches_any(name, exclude_glob):
                continue
        result.append(p)
    return result


def _dedup_by_path(paths: List[Path]) -> List[Path]:
    """Deduplicate by absolute normalized path, preserving order."""
    seen = set()
    out: List[Path] = []
    for p in paths:
        key = str(p.resolve())
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def _file_hash(path: Path, chunk_size: int = 1024 * 1024) -> str:
    """Compute SHA-256 for a file."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _dedup_by_hash(paths: List[Path]) -> List[Path]:
    """Deduplicate by content hash, preserving first occurrence."""
    seen = set()
    out: List[Path] = []
    for p in paths:
        # If a file disappeared mid-run, let the later existence check handle it.
        try:
            digest = _file_hash(p)
        except FileNotFoundError:
            digest = f"missing::{p}"
        if digest not in seen:
            seen.add(digest)
            out.append(p)
    return out


def _collect_from_folder(folder: Path, include_glob: List[str], exclude_glob: List[str]) -> List[Path]:
    """
    Collect files from a folder NON-RECURSIVELY (only immediate children that are files),
    then apply include/exclude filters.
    """
    if not folder.exists() or not folder.is_dir():
        raise FileNotFoundError(f"Folder not found or not a directory: {folder}")

    # Non-recursive collection: only files directly inside `folder`
    immediate_files = [p for p in folder.iterdir() if p.is_file()]
    # Sort for stable output
    immediate_files.sort(key=lambda p: p.name.lower())
    return _filter_names(immediate_files, include_glob, exclude_glob)


def read_manifest(path: Path) -> Tuple[Path, List[Path]]:
    """
    Read a manifest JSON and return (output_path, file_paths).

    Supported manifest formats:

    Minimal (explicit files):
    {
      "output": "out/combined.txt",
      "files": ["a.py", "b.txt"]
    }

    Folder-based extraction (non-recursive):
    {
      "output": "out/combined.txt",
      "folder": "src",                 // DEPRECATED alias of 'folders'
      "folders": ["src", "src/adapters"], // string or list accepted
      "include_glob": ["*.py", "*.ts"],// optional; string or list; default matches all
      "exclude_glob": ["*.spec.ts"],   // optional; string or list
      "dedup": "path"                  // "path" (default) | "hash" | "none"
    }

    You may also combine "files" with "folder"/"folders"; results are merged before dedup.
    """
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError as e:
        raise FileNotFoundError(f"JSON manifest not found: {path}") from e
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in {path}: {e}") from e

    if not isinstance(data, dict):
        raise ValueError("Manifest must be a JSON object.")

    output = data.get("output")
    if not isinstance(output, str) or not output.strip():
        raise ValueError("'output' must be a non-empty string.")
    output_path = Path(output)

    files_section = data.get("files")

    # Support both 'folder' (deprecated) and 'folders' (preferred)
    folders_section = data.get("folders")
    folder_deprecated = data.get("folder")

    include_glob = _as_list(data.get("include_glob"))  # default: include all if empty
    exclude_glob = _as_list(data.get("exclude_glob"))
    dedup_mode = data.get("dedup", "path")
    if dedup_mode not in {"path", "hash", "none"}:
        raise ValueError("dedup must be one of: 'path', 'hash', 'none'.")

    collected: List[Path] = []

    # Explicit files (backward compatible)
    if files_section is not None:
        if not isinstance(files_section, list) or not all(isinstance(x, str) for x in files_section):
            raise ValueError("'files' must be a list of filenames (strings).")
        collected.extend(Path(p) for p in files_section)

    # Normalize folders (supports both keys)
    folders: List[str] = []
    if folders_section is not None:
        folders.extend(_as_list(folders_section))
    if folder_deprecated is not None:
        folders.extend(_as_list(folder_deprecated))

    # Folder-based extraction (non-recursive for each folder)
    if folders:
        for folder_str in folders:
            if not isinstance(folder_str, str) or not folder_str.strip():
                raise ValueError("Each folder path must be a non-empty string.")
            folder_path = Path(folder_str)
            folder_files = _collect_from_folder(folder_path, include_glob, exclude_glob)
            collected.extend(folder_files)

    if not collected:
        raise ValueError("No files specified. Provide 'files' and/or 'folders' (or legacy 'folder') in the manifest.")

    # Deduplication
    if dedup_mode == "path":
        collected = _dedup_by_path(collected)
    elif dedup_mode == "hash":
        collected = _dedup_by_hash(collected)
    # elif "none": keep as-is

    return output_path, collected


# -------------------------
# Compilation
# -------------------------

def compile_files(output_path: Path, file_paths: List[Path]) -> None:
    # Validate inputs exist before writing anything
    missing = [p for p in file_paths if not p.exists()]
    if missing:
        msg = "\n".join(f"- {p}" for p in missing)
        raise FileNotFoundError(f"Input file(s) not found:\n{msg}")

    # Ensure parent directory for output exists (if any)
    if output_path.parent and not output_path.parent.exists():
        output_path.parent.mkdir(parents=True, exist_ok=True)

    # Write output (overwrite if exists)
    with output_path.open("w", encoding="utf-8", newline="\n") as out:
        for src in file_paths:
            out.write(str(src).replace("\\", "/"))  # normalize to forward slashes in header
            out.write("\n")
            try:
                with src.open("r", encoding="utf-8") as f:
                    out.write(f.read())
            except UnicodeDecodeError:
                with src.open("rb") as fb:
                    out.write(fb.read().decode("utf-8", errors="replace"))
            out.write("\n\n")


def process_manifest(manifest_path: Path) -> Tuple[bool, Optional[Path], int, Optional[str]]:
    """Return (ok, output_path, file_count, error_message)."""
    try:
        output_path, file_paths = read_manifest(manifest_path)
        compile_files(output_path, file_paths)
        return True, output_path, len(file_paths), None
    except Exception as e:
        return False, None, 0, str(e)


# -------------------------
# CLI
# -------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Compile files listed in JSON manifests into a single txt file with filename headers. "
                    "Supports explicit file lists and folder-based (non-recursive) extraction with optional dedup."
    )
    mode = parser.add_mutually_exclusive_group(required=False)
    mode.add_argument(
        "manifest",
        type=Path,
        nargs="?",
        help="Path to a single JSON manifest with at least 'output' and either 'files' or 'folders'/'folder'."
    )
    mode.add_argument(
        "--batch",
        action="store_true",
        help="Process all JSON manifests in a directory (use --dir; default: ./jsons)."
    )
    parser.add_argument(
        "--dir",
        type=Path,
        default=Path("./jsons"),
        help="Directory containing JSON manifests when using --batch (default: ./jsons)."
    )

    args = parser.parse_args()

    if args.batch:
        folder: Path = args.dir
        if not folder.exists() or not folder.is_dir():
            print(f"[error] Directory not found or not a directory: {folder}", file=sys.stderr)
            sys.exit(1)

        manifests = sorted(p for p in folder.glob("*.json") if p.is_file())
        if not manifests:
            print(f"[warn] No JSON manifests found in {folder}")
            sys.exit(0)

        ok_count = 0
        fail_count = 0
        for mf in manifests:
            ok, outp, n, err = process_manifest(mf)
            if ok:
                print(f"[ok] {mf} → {outp} ({n} file(s)).")
                ok_count += 1
            else:
                print(f"[fail] {mf}: {err}", file=sys.stderr)
                fail_count += 1

        print(f"[summary] processed={len(manifests)} ok={ok_count} failed={fail_count}")
        sys.exit(0 if fail_count == 0 else 1)

    # Single-manifest mode
    if not args.manifest:
        print("[error] Provide a manifest path, or use --batch.", file=sys.stderr)
        sys.exit(1)

    ok, outp, n, err = process_manifest(args.manifest)
    if not ok:
        print(f"[error] {err}", file=sys.stderr)
        sys.exit(1)

    print(f"[ok] Wrote {outp} ({n} file(s)).")


if __name__ == "__main__":
    main()

# -------------------------
# Examples:
#   python file_compiler.py manifest.json
#   python file_compiler.py --batch --dir ./jsons
#
# Example manifest (multiple folders, non-recursive, dedup by hash):
# {
#   "output": "out/combined.txt",
#   "folders": ["features/rag", "features/rag/adapters"],
#   "include_glob": ["*.py", "*.ts"],
#   "exclude_glob": "*.spec.ts",
#   "dedup": "hash"
# }
#
# Example manifest (mix files + folders, dedup by path - default):
# {
#   "output": "out/combined.txt",
#   "files": ["README.md", "scripts/util.py"],
#   "folders": ["features/rag", "features/rag/adapters"],
#   "include_glob": "*",
#   "dedup": "path"
# }
