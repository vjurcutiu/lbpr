#!/usr/bin/env python3
import argparse
import fnmatch
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import List, Tuple, Optional, Any, Iterable

VERBOSE = False

# Allow opt-in verbosity via env as well
try:
    if os.environ.get('FILE_COMPILER_VERBOSE', '') in ('1', 'true', 'TRUE', 'yes', 'Yes'):
        VERBOSE = True
except Exception:
    pass


def _dbg(*args):
    if VERBOSE:
        try:
            print("[verbose]", *args, flush=True)
        except Exception:
            pass


# -------------------------
# Ignore file support
# -------------------------

DEFAULT_IGNORE_FILENAME = ".compiler_ignore"


def _normalize_pattern(line: str) -> str:
    """Normalize a single ignore pattern line for cross-platform matching."""
    # Allow escaped dot "\." to become "."
    line = line.replace(r"\.", ".")
    # Normalize path separators to POSIX style
    line = line.replace("\\", "/")
    return line


def _load_ignore_patterns(ignore_file: Path) -> List[str]:
    """
    Load ignore patterns from a .compiler_ignore file.
    - Empty lines and lines starting with '#' are ignored.
    - Patterns use Unix shell-style wildcards (fnmatch), and are matched
      against POSIX-style paths.
    - A pattern ending with a trailing slash (e.g. 'build/') ignores that directory and its contents.
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
                patterns.append(_normalize_pattern(line))
    except FileNotFoundError:
        pass
    return patterns


def _merge_patterns(*lists: List[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for lst in lists:
        for p in lst:
            if p not in seen:
                seen.add(p)
                out.append(p)
    return out


def _path_matches_any_detail(path_posix: str, patterns: List[str]):
    """
    Return (matched: bool, pattern: Optional[str], reason: str) for the *path_posix*.
    - If a pattern ends with '/', it acts like a directory-segment match, i.e. any '/<dir>/' segment.
    - Otherwise, we try glob against the full relative path and the basename.
    """
    import fnmatch as _fn
    basename = path_posix.split("/")[-1]
    hay = f"/{path_posix.strip('/')}/"
    for pat in patterns:
        if not pat:
            continue
        if pat.endswith("/"):
            dir_pat = pat.rstrip("/")
            if not dir_pat:
                continue
            needle = f"/{dir_pat}/"
            if needle in hay:
                return True, pat, "dir-segment"
        else:
            if _fn.fnmatch(path_posix, pat):
                return True, pat, "path-glob"
            if _fn.fnmatch(basename, pat):
                return True, pat, "basename-glob"
    return False, None, ""


def _is_ignored(path: Path, base_dir: Path, ignore_patterns: List[str]) -> bool:
    """
    Return True if path should be ignored based on ignore_patterns.
    Matching is done on the POSIX-style relative path to base_dir.
    """
    try:
        rel = path.resolve().relative_to(base_dir.resolve())
        rel_str = rel.as_posix()
    except Exception:
        rel_str = path.as_posix().replace("\\", "/")

    matched, pat, why = _path_matches_any_detail(rel_str, ignore_patterns)
    if matched:
        _dbg('ignore', rel_str, 'matched', pat, f'({why})')
        return True

    # Check ancestor directories for trailing-slash directory patterns
    parts = rel_str.split("/")
    accum = ""
    for i, part in enumerate(parts[:-1]):
        accum = part if i == 0 else f"{accum}/{part}"
        matched2, pat2, why2 = _path_matches_any_detail(accum + "/", ignore_patterns)
        if matched2:
            _dbg('ignore via ancestor', accum + '/', 'matched', pat2, f'({why2})')
            return True

    _dbg('keep', rel_str, 'no pattern match')
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

def _as_str_or_key(d: dict, *keys: str) -> Optional[str]:
    """Helper to fetch the first present key from dict and ensure it's a non-empty string."""
    for k in keys:
        if k in d and isinstance(d[k], str) and d[k].strip():
            return d[k]
    return None


def _parse_folder_specs(
    section_value: Any,
    manifest_dir: Path,
    default_recursive: bool,
    global_include: List[str],
    global_exclude: List[str],
) -> List[Tuple[Path, List[str], List[str], bool]]:
    """
    Normalize a manifest section ("folders" or "recurse_folders") into a list of tuples:
      (folder_path, include_glob, exclude_glob, recursive_flag)

    Supported inputs:
      - list[str]: treated as folder paths using global include/exclude and default_recursive.
      - list[dict]: each object may contain keys:
            "folder" | "path": string (required)
            "include_only" | "include_glob": string | list[str] (optional, overrides global)
            "exclude_glob": string | list[str] (optional, overrides global)
            "recursive": bool (optional; if omitted, uses default_recursive)
      - For backward compatibility, a bool is allowed ONLY for the "recurse_folders" top-level key.
    """
    specs: List[Tuple[Path, List[str], List[str], bool]] = []

    # If None: nothing
    if section_value is None:
        return specs

    # If list of strings:
    if isinstance(section_value, list) and all(isinstance(x, str) for x in section_value):
        for folder_str in section_value:
            folder_path = (manifest_dir / folder_str).resolve() if not os.path.isabs(folder_str) else Path(folder_str).resolve()
            specs.append((folder_path, list(global_include), list(global_exclude), default_recursive))
        return specs

    # If list of dicts:
    if isinstance(section_value, list) and all(isinstance(x, dict) for x in section_value):
        for item in section_value:
            folder_str = _as_str_or_key(item, "folder", "path")
            if not folder_str:
                raise ValueError("Each folder spec must include a non-empty 'folder' (or 'path') string.")
            inc = item.get("include_only", item.get("include_glob", None))
            exc = item.get("exclude_glob", None)
            recursive_flag = item.get("recursive", default_recursive)

            inc_list = _as_list(inc) if inc is not None else list(global_include)
            exc_list = _as_list(exc) if exc is not None else list(global_exclude)

            folder_path = (manifest_dir / folder_str).resolve() if not os.path.isabs(folder_str) else Path(folder_str).resolve()
            specs.append((folder_path, inc_list, exc_list, bool(recursive_flag)))
        return specs

    # If it's a bool, the caller (read_manifest) should treat it specially (legacy for recurse_folders).
    if isinstance(section_value, bool):
        # We do not return specs here; caller handles legacy behavior.
        return specs

    raise ValueError("Invalid section format. Expected list of strings or list of objects.")



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
            _dbg("filter: exclude by include_glob", name)
            continue
        if exclude_glob and matches_any(name, exclude_glob):
            _dbg("filter: exclude by exclude_glob", name)
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

    scanning_root = folder.resolve()

    # Merge patterns from the scanned folder's own .compiler_ignore (if any)
    folder_local_patterns = _load_ignore_patterns(scanning_root / DEFAULT_IGNORE_FILENAME)
    patterns = _merge_patterns(ignore_patterns, folder_local_patterns)
    if folder_local_patterns:
        _dbg("using-local-ignore", str(scanning_root / DEFAULT_IGNORE_FILENAME), folder_local_patterns)

    _dbg("scan-folder", str(folder), "recursive=", recursive)
    results: List[Path] = []

    if not recursive:
        immediate_files = [p for p in folder.iterdir() if p.is_file()]
        immediate_files.sort(key=lambda p: p.name.lower())
        immediate_files = [p for p in immediate_files if not _is_ignored(p, scanning_root, patterns)]
        return _filter_names(immediate_files, include_glob, exclude_glob)

    for root_dir, dirs, files in os.walk(folder):
        root_path = Path(root_dir)
        # Prune ignored dirs
        for d in list(dirs):
            d_path = root_path / d
            if _is_ignored(d_path, scanning_root, patterns):
                _dbg('prune-dir', str(d_path))
                dirs.remove(d)

        for fname in files:
            fpath = root_path / fname
            if _is_ignored(fpath, scanning_root, patterns):
                continue
            results.append(fpath)

    results.sort(key=lambda p: p.name.lower())
    return _filter_names(results, include_glob, exclude_glob)


# -------------------------
# Manifest parsing
# -------------------------

def _load_global_ignore() -> List[str]:
    """
    Load 'global' ignore rules from the directory where this script resides.
    These act as general rules across all scans.
    """
    try:
        script_dir = Path(__file__).resolve().parent
    except NameError:
        # Fallback when __file__ is unavailable (rare)
        script_dir = Path.cwd()
    return _load_ignore_patterns(script_dir / DEFAULT_IGNORE_FILENAME)


def read_manifest(path: Path) -> Tuple[Path, List[Path]]:
    """
    Read a manifest JSON and return (output_path, file_paths).

    New behavior:
      - "folders": list of folders scanned NON-recursively.
      - "recurse_folders":
          • list of folder paths (strings) scanned RECURSIVELY, or
          • list of objects with per-folder options:
              { "folder": "path", "include_only": [..], "exclude_glob": [..], "recursive": true }
        (Backward compat: if recurse_folders is true, all "folders" are treated as recursive.)

    Other options:
      - "files": explicit file list.
      - "include_glob"/"exclude_glob": filename-level filters.
      - "dedup": "path" | "hash" | "none".
      - Ignore precedence:
          GLOBAL (.compiler_ignore next to file_compiler.py)
          + MANIFEST (.compiler_ignore next to manifest)
          + FOLDER-LOCAL (.compiler_ignore inside each scanned folder)
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

    global_ignore = _load_global_ignore()
    manifest_ignore = _load_ignore_patterns(manifest_dir / DEFAULT_IGNORE_FILENAME)
    base_ignore_patterns = _merge_patterns(global_ignore, manifest_ignore)
    if global_ignore:
        _dbg("global-ignore", global_ignore)
    if manifest_ignore:
        _dbg("manifest-ignore", manifest_ignore)

    collected: List[Path] = []

    # Files
    if files_section is not None:
        if not isinstance(files_section, list) or not all(isinstance(x, str) for x in files_section):
            raise ValueError("'files' must be a list of filenames (strings).")
        for p_str in files_section:
            p = (manifest_dir / p_str).resolve() if not os.path.isabs(p_str) else Path(p_str).resolve()
            local_patterns = _load_ignore_patterns(p.parent / DEFAULT_IGNORE_FILENAME)
            patterns = _merge_patterns(base_ignore_patterns, local_patterns)
            if not _is_ignored(p, p.parent.resolve(), patterns):
                collected.append(p)
            else:
                _dbg("skip-file-by-ignore", str(p))

    # Determine recursive folders (support list[str] and list[object] with per-folder include_only)
    legacy_bool = False
    recursive_specs: List[Tuple[Path, List[str], List[str], bool]] = []

    if isinstance(recurse_section, bool):
        # Legacy: if true, all items under 'folders' become recursive using global include/exclude
        legacy_bool = recurse_section
    else:
        # New: parse object/list specs for recurse_folders
        recursive_specs = _parse_folder_specs(recurse_section, manifest_dir, True, include_glob, exclude_glob)

    # Non-recursive folders (support object/list specs too)
    folder_specs: List[Tuple[Path, List[str], List[str], bool]] = _parse_folder_specs(folders_nonrec, manifest_dir, False, include_glob, exclude_glob)

    # If legacy_bool is True, upgrade the above folder_specs to be recursive
    if legacy_bool and folder_specs:
        folder_specs = [(fp, inc, exc, True) for (fp, inc, exc, _r) in folder_specs]

    # Collect from non-recursive (or legacy-upgraded) folder specs
    for (folder_path, inc_glob, exc_glob, rec_flag) in folder_specs:
        files = _collect_from_folder(
            folder_path,
            inc_glob,
            exc_glob,
            folder_path.resolve(),
            base_ignore_patterns,
            rec_flag,
        )
        collected.extend(files)

    # Collect from recursive specs (explicit recurse_folders list)
    for (folder_path, inc_glob, exc_glob, rec_flag) in recursive_specs:
        files = _collect_from_folder(
            folder_path,
            inc_glob,
            exc_glob,
            folder_path.resolve(),
            base_ignore_patterns,
            rec_flag,
        )
        collected.extend(files)

    if not collected:
        raise ValueError("No files specified. Provide 'files' and/or 'folders'/'recurse_folders' in the manifest.")

    _dbg("collected_count_before_dedup", len(collected))

    if dedup_mode == "path":
        collected = _dedup_by_path(collected)
    elif dedup_mode == "hash":
        collected = _dedup_by_hash(collected)

    _dbg("collected_count_after_dedup", len(collected))
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
    _dbg("wrote_output", str(output_path))


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
        "plus optional per-folder include_only/exclude_glob, dedup and .compiler_ignore."
    ))

    parser.add_argument("-v", "--verbose", action="store_true", help="Enable verbose debug logging.")
    parser.add_argument("--explain-ignore", nargs="+", metavar="PATH",
                        help="Explain whether each PATH would be ignored using the manifest's .compiler_ignore. "
                             "Useful for debugging ignore rules. Requires single-manifest mode.")

    mode = parser.add_mutually_exclusive_group(required=False)
    mode.add_argument("manifest", type=Path, nargs="?", help="Path to a single JSON manifest.")
    mode.add_argument("--batch", action="store_true", help="Process all JSON manifests in a directory (use --dir).")

    parser.add_argument("--dir", type=Path, default=Path("./jsons"), help="Directory for --batch (default: ./jsons).")
    parser.add_argument("--ignore", type=Path, default=None, help="Optional path to a .compiler_ignore override (single-file mode).")

    args = parser.parse_args()

    global VERBOSE
    VERBOSE = bool(VERBOSE or getattr(args, 'verbose', False))

    if args.batch and args.explain_ignore:
        print("[error] --explain-ignore is only available with a single manifest.", file=sys.stderr)
        sys.exit(1)

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
            _dbg("process-manifest", str(mf))
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

    manifest_dir = args.manifest.parent if args.manifest.parent else Path(".")

    # Optional override for .compiler_ignore
    if args.ignore is not None and args.ignore.exists():
        temp_ignore = manifest_dir / DEFAULT_IGNORE_FILENAME
        if not temp_ignore.exists():
            try:
                temp_ignore.write_text(args.ignore.read_text(encoding="utf-8"), encoding="utf-8")
                _dbg("applied-ignore-override", str(args.ignore), "→", str(temp_ignore))
            except Exception as e:
                print(f"[warn] Could not apply --ignore override: {e}", file=sys.stderr)

    # Explain mode for targeted paths
    if args.explain_ignore:
        patterns = _load_ignore_patterns(manifest_dir / DEFAULT_IGNORE_FILENAME)
        # merge with global as well (so explanation reflects true behavior)
        patterns = _merge_patterns(_load_global_ignore(), patterns)
        print(f"[info] Using {DEFAULT_IGNORE_FILENAME} from: {manifest_dir} + script dir")
        print(f"[info] Patterns: {patterns}")
        base = manifest_dir.resolve()
        for p in args.explain_ignore:
            p_path = (base / p).resolve() if not os.path.isabs(p) else Path(p).resolve()
            try:
                rel = p_path.relative_to(base).as_posix()
            except Exception:
                rel = p_path.as_posix().replace("\\", "/")
            matched, pat, why = _path_matches_any_detail(rel, patterns)
            if not matched:
                # ancestor check
                parts = rel.split("/")
                accum = ""
                for i, part in enumerate(parts[:-1]):
                    accum = part if i == 0 else f"{accum}/{part}"
                    m2, pat2, why2 = _path_matches_any_detail(accum + "/", patterns)
                    if m2:
                        matched, pat, why = m2, pat2, why2 + " (ancestor)"
                        break

            print(f"{'IGNORED ' if matched else 'KEPT    '} {rel}  "
                  f"{'by ' + str(pat) + ' (' + str(why) + ')' if matched else '(no match)'}")
        sys.exit(0)

    ok, outp, n, err = process_manifest(args.manifest)
    if not ok:
        print(f"[error] {err}", file=sys.stderr)
        sys.exit(1)
    print(f"[ok] Wrote {outp} ({n} file(s)).")


if __name__ == "__main__":
    main()
