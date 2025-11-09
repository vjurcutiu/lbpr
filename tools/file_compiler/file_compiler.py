#!/usr/bin/env python3
import argparse
import fnmatch
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import List, Tuple, Optional, Dict, Any, Iterable


# -------------------------
# Ignore file support
# -------------------------

DEFAULT_IGNORE_FILENAME = ".compiler_ignore"


def _load_ignore_patterns(ignore_file: Path) -> List[str]:
    """
    Load ignore patterns from a .compiler_ignore file.
    - Empty lines and lines starting with '#' are ignored.
    - Patterns use Unix shell-style wildcards (fnmatch), and are matched
      against POSIX-style paths relative to the manifest directory.
    - A pattern ending with a trailing slash (e.g. 'build/') ignores that directory and all its contents.
    """
    patterns: List[str] = []
    try:
        with ignore_file.open("r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if line.endswith("\\"):
                    line = line.rstrip("\\").rstrip()
                patterns.append(line.replace("\\", "/"))
    except FileNotFoundError:
        pass
    return patterns


def _path_matches_any(path_posix: str, patterns: List[str]) -> bool:
    """
    Match path_posix (a POSIX-style relative path) against ignore patterns.
    - If a pattern ends with '/', treat it as a directory prefix ignore (dir/**).
    - Otherwise, fnmatch the full relative path and also the basename for convenience.
    """
    basename = path_posix.split("/")[-1]
    for pat in patterns:
        if pat.endswith("/"):
            prefix = pat
            if path_posix.startswith(prefix) or (path_posix + "/").startswith(prefix):
                return True
        else:
            if fnmatch.fnmatch(path_posix, pat) or fnmatch.fnmatch(basename, pat):
                return True
    return False


def _is_ignored(path: Path, base_dir: Path, ignore_patterns: List[str]) -> bool:
    """
    Return True if path should be ignored based on ignore_patterns.
    Matching is done on the POSIX-style relative path to base_dir.
    """
    try:
        rel = path.resolve().relative_to(base_dir.resolve())
        rel_str = rel.as_posix()
    except Exception:
        rel_str = path.name

    if _path_matches_any(rel_str, ignore_patterns):
        return True
    # Also check each ancestor directory prefix (dir/ semantics)
    parts = rel_str.split("/")
    accum = ""
    for i, part in enumerate(parts[:-1]):
        accum = part if i == 0 else f"{accum}/{part}"
        if _path_matches_any(accum + "/", ignore_patterns):
            return True
    return False


# -------------------------
# Helpers
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
        if include_glob and not matches_any(name, include_glob):
            continue
        if exclude_glob and matches_any(name, exclude_glob):
            continue
        result.append(p)
    return result


def _dedup_by_path(paths: List[Path]) -> List[Path]:
    seen = set()
    out: List[Path] = []
    for p in paths:
        key = str(p.resolve())
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def _file_hash(path: Path, chunk_size: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _dedup_by_hash(paths: List[Path]) -> List[Path]:
    seen = set()
    out: List[Path] = []
    for p in paths:
        try:
            digest = _file_hash(p)
        except FileNotFoundError:
            digest = f"missing::{p}"
        if digest not in seen:
            seen.add(digest)
            out.append(p)
    return out


def _collect_from_folder(
    folder: Path,
    include_glob: List[str],
    exclude_glob: List[str],
    base_dir: Path,
    ignore_patterns: List[str],
    recursive: bool,
) -> List[Path]:
    if not folder.exists() or not folder.is_dir():
        raise FileNotFoundError(f"Folder not found or not a directory: {folder}")

    results: List[Path] = []

    if not recursive:
        immediate_files = [p for p in folder.iterdir() if p.is_file()]
        immediate_files.sort(key=lambda p: p.name.lower())
        immediate_files = [p for p in immediate_files if not _is_ignored(p, base_dir, ignore_patterns)]
        return _filter_names(immediate_files, include_glob, exclude_glob)

    for root, dirs, files in os.walk(folder):
        root_path = Path(root)
        # Prune ignored dirs
        for d in list(dirs):
            d_path = root_path / d
            if _is_ignored(d_path, base_dir, ignore_patterns):
                dirs.remove(d)

        for fname in files:
            fpath = root_path / fname
            if _is_ignored(fpath, base_dir, ignore_patterns):
                continue
            results.append(fpath)

    results.sort(key=lambda p: p.name.lower())
    return _filter_names(results, include_glob, exclude_glob)


# -------------------------
# Manifest parsing
# -------------------------

def read_manifest(path: Path) -> Tuple[Path, List[Path]]:
    """
    Read a manifest JSON and return (output_path, file_paths).

    New behavior:
      - "folders": list of folders scanned NON-recursively.
      - "recurse_folders": list of folders scanned RECURSIVELY.
        (Backward compat: if recurse_folders is true, all "folders" are treated as recursive.)

    Other options:
      - "files": explicit file list.
      - "include_glob"/"exclude_glob": filename-level filters.
      - "dedup": "path" | "hash" | "none".
      - .compiler_ignore next to the manifest defines ignore patterns.
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
    folders_nonrec = data.get("folders") or data.get("folder")
    recurse_section = data.get("recurse_folders", None)

    include_glob = _as_list(data.get("include_glob"))
    exclude_glob = _as_list(data.get("exclude_glob"))
    dedup_mode = data.get("dedup", "path")
    if dedup_mode not in {"path", "hash", "none"}:
        raise ValueError("dedup must be one of: 'path', 'hash', 'none'.")

    manifest_dir = path.parent if path.parent else Path(".")
    ignore_patterns = _load_ignore_patterns(manifest_dir / DEFAULT_IGNORE_FILENAME)

    collected: List[Path] = []

    # Files
    if files_section is not None:
        if not isinstance(files_section, list) or not all(isinstance(x, str) for x in files_section):
            raise ValueError("'files' must be a list of filenames (strings).")
        for p_str in files_section:
            p = (manifest_dir / p_str).resolve()
            if not _is_ignored(p, manifest_dir.resolve(), ignore_patterns):
                collected.append(p)

    # Determine recursive folders
    recursive_folders: List[str] = []
    legacy_bool = False
    if isinstance(recurse_section, bool):
        legacy_bool = recurse_section
    elif recurse_section is not None:
        recursive_folders = _as_list(recurse_section)

    # Non-recursive folders
    if folders_nonrec:
        folders_list: List[str] = _as_list(folders_nonrec)
        for folder_str in folders_list:
            folder_path = (manifest_dir / folder_str).resolve()
            # If legacy bool true, treat these as recursive
            recursive_flag = True if legacy_bool else False
            files = _collect_from_folder(
                folder_path,
                include_glob,
                exclude_glob,
                manifest_dir.resolve(),
                ignore_patterns,
                recursive_flag,
            )
            collected.extend(files)

    # Recursive folders (new list-based behavior)
    for folder_str in recursive_folders:
        folder_path = (manifest_dir / folder_str).resolve()
        files = _collect_from_folder(
            folder_path,
            include_glob,
            exclude_glob,
            manifest_dir.resolve(),
            ignore_patterns,
            True,
        )
        collected.extend(files)

    if not collected:
        raise ValueError("No files specified. Provide 'files' and/or 'folders'/'recurse_folders' in the manifest.")

    if dedup_mode == "path":
        collected = _dedup_by_path(collected)
    elif dedup_mode == "hash":
        collected = _dedup_by_hash(collected)

    return output_path, collected


# -------------------------
# Compilation
# -------------------------

def compile_files(output_path: Path, file_paths: List[Path]) -> None:
    missing = [p for p in file_paths if not p.exists()]
    if missing:
        msg = "\n".join(f"- {p}" for p in missing)
        raise FileNotFoundError(f"Input file(s) not found:\n{msg}")

    if output_path.parent and not output_path.parent.exists():
        output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w", encoding="utf-8", newline="") as out:
        for src in file_paths:
            header = str(src.resolve())
            out.write(header.replace("\\", "/"))
            out.write("\n")
            try:
                with src.open("r", encoding="utf-8") as f:
                    out.write(f.read())
            except UnicodeDecodeError:
                with src.open("rb") as fb:
                    out.write(fb.read().decode("utf-8", errors="replace"))
            out.write("\n\n")


def process_manifest(manifest_path: Path) -> Tuple[bool, Optional[Path], int, Optional[str]]:
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
    parser = argparse.ArgumentParser(description=(
        "Compile files listed in JSON manifests into a single txt file with filename headers. "
        "Supports explicit file lists and folder-based extraction with recursive and non-recursive lists, "
        "plus optional dedup and .compiler_ignore."
    ))
    mode = parser.add_mutually_exclusive_group(required=False)
    mode.add_argument("manifest", type=Path, nargs="?", help="Path to a single JSON manifest.")
    mode.add_argument("--batch", action="store_true", help="Process all JSON manifests in a directory (use --dir).")
    parser.add_argument("--dir", type=Path, default=Path("./jsons"), help="Directory for --batch (default: ./jsons).")
    parser.add_argument("--ignore", type=Path, default=None, help="Optional path to a .compiler_ignore override (single-file mode).")
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
        ok_count = fail_count = 0
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

    if not args.manifest:
        print("[error] Provide a manifest path, or use --batch.", file=sys.stderr)
        sys.exit(1)

    # Simple override approach: if --ignore provided and local .compiler_ignore is missing, write a temp one.
    if args.ignore is not None and args.ignore.exists():
        manifest_dir = args.manifest.parent if args.manifest.parent else Path(".")
        temp_ignore = manifest_dir / DEFAULT_IGNORE_FILENAME
        if not temp_ignore.exists():
            try:
                temp_ignore.write_text(args.ignore.read_text(encoding="utf-8"), encoding="utf-8")
            except Exception as e:
                print(f"[warn] Could not apply --ignore override: {e}", file=sys.stderr)

    ok, outp, n, err = process_manifest(args.manifest)
    if not ok:
        print(f"[error] {err}", file=sys.stderr)
        sys.exit(1)
    print(f"[ok] Wrote {outp} ({n} file(s)).")


if __name__ == "__main__":
    main()

# -------------------------
# Examples
#
# New manifest style (non-recursive + recursive):
# {
#   "output": "out/combined.txt",
#   "folders": ["src", "scripts"],                 // non-recursive
#   "recurse_folders": ["features", "packages"],   // recursive
#   "include_glob": ["*.py", "*.ts", "*.tsx"],
#   "exclude_glob": ["*.spec.ts"],
#   "dedup": "path"
# }
#
# Backward compatible style:
# {
#   "output": "out/combined.txt",
#   "folders": ["src", "features"],
#   "recurse_folders": true,   // treat all 'folders' as recursive (legacy behavior)
#   "include_glob": "*"
# }
#
# .compiler_ignore example:
#   build/
#   dist/
#   *.log
#   **/*.spec.ts
#   docs/**/draft-*
