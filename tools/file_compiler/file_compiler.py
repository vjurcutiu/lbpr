#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path
from typing import List, Tuple, Optional

def read_manifest(path: Path) -> Tuple[Path, List[Path]]:
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError as e:
        raise FileNotFoundError(f"JSON manifest not found: {path}") from e
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in {path}: {e}") from e

    if not isinstance(data, dict):
        raise ValueError("Manifest must be a JSON object with 'output' and 'files' keys.")

    output = data.get("output")
    files = data.get("files")

    if not isinstance(output, str) or not output.strip():
        raise ValueError("'output' must be a non-empty string.")
    if not isinstance(files, list) or not all(isinstance(x, str) for x in files):
        raise ValueError("'files' must be a list of filenames (strings).")

    output_path = Path(output)
    file_paths = [Path(p) for p in files]
    return output_path, file_paths

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

def main():
    parser = argparse.ArgumentParser(
        description="Compile files listed in JSON manifests into a single txt file with filename headers."
    )
    mode = parser.add_mutually_exclusive_group(required=False)
    mode.add_argument(
        "manifest",
        type=Path,
        nargs="?",
        help="Path to a single JSON manifest with 'output' and 'files' keys."
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

# Examples:
#   python file_compiler.py manifest.json
#   python file_compiler.py --batch --dir ./jsons
