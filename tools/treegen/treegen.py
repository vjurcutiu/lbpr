#!/usr/bin/env python3

"""
treegen.py — Generate an ASCII file tree for a given folder, with layered .treeignore rules.

What's new in v2
- Reads .treeignore from:
  1) The script's install folder (global rules, lowest priority).
  2) The target root folder (medium priority).
  3) Each visited subfolder (highest priority for their subtree).
- Later rules override earlier ones, mirroring how nested ignore files typically behave.

Usage:
  python treegen.py --config /path/to/config.json

Config JSON (minimal):
{
  "root": "/path/to/scan",
  "output_dir": "/path/to/write",
  "output_file": "tree.txt"
}

Optional keys:
  "include_hidden": false,
  "follow_symlinks": false,
  "max_depth": null,
  "sort": "name",            # "name" | "type"
  "encoding": "utf-8",
  "use_global_treeignore": true  # read .treeignore next to this script
}

.treeignore syntax (subset of .gitignore):
- Blank lines and lines starting with '#' are comments.
- '!' at the beginning negates (re-includes) a previous match.
- Trailing '/' targets directories only.
- Leading '/' anchors the pattern to the directory containing that .treeignore.
- Patterns without '/' match basenames (file or dir names) anywhere beneath that directory.
- Supports '*', '?', and '**' (spans path separators).

Limitations:
- If a directory is ignored by rules from a parent scope, its own .treeignore is not read
  (same practical consequence as many tools).
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path, PurePosixPath
from dataclasses import dataclass
from typing import List, Optional, Tuple, Iterable

# --------------------------- Ignore rules ---------------------------

@dataclass
class IgnoreRule:
    pattern: str            # POSIX pattern (no trailing '/')
    negation: bool          # True if line started with '!'
    dir_only: bool          # True if original ended with '/'
    anchored: bool          # True if original started with '/'
    base_dir: Path          # directory that owns this .treeignore
    original: str           # original raw line

def _read_treeignore_file(base_dir: Path, filename: str = ".treeignore") -> List[IgnoreRule]:
    rules: List[IgnoreRule] = []
    path = base_dir / filename
    if not path.exists():
        return rules
    text = path.read_text(encoding="utf-8", errors="ignore")
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        neg = line.startswith("!")
        if neg:
            line = line[1:].strip()
            if not line:
                continue
        anchored = line.startswith("/")
        if anchored:
            line = line[1:]
        dir_only = line.endswith("/")
        if dir_only:
            line = line[:-1] or "."
        pattern = line.replace("\\", "/")
        rules.append(IgnoreRule(
            pattern=pattern,
            negation=neg,
            dir_only=dir_only,
            anchored=anchored,
            base_dir=base_dir,
            original=raw
        ))
    return rules

def _match_rule(path: Path, is_dir: bool, rule: IgnoreRule) -> bool:
    """
    Evaluate one rule against a concrete path.
    Matching is computed relative to rule.base_dir.
    """
    try:
        rel = path.relative_to(rule.base_dir)
    except ValueError:
        # Path is outside rule scope
        return False

    rel_posix = rel.as_posix() if str(rel) != "." else ""
    rel_pp = PurePosixPath(rel_posix or ".")

    if rule.dir_only and not is_dir:
        return False

    has_slash = "/" in rule.pattern

    if rule.anchored:
        # anchored to base_dir — match must start at the base
        target = PurePosixPath(rel_posix or "")
        # If the pattern is empty (edge case), it matches only the base dir itself
        pat = rule.pattern or ""
        return target.match(pat if pat else ".")

    # Non-anchored
    if has_slash:
        # Match against full rel path (supports **)
        return rel_pp.match(rule.pattern)

    # No slash: match against basename only
    name = rel_pp.name if rel_posix else rule.base_dir.name
    return PurePosixPath(name).match(rule.pattern)

def make_is_ignored(global_rules: List[IgnoreRule], root_rules: List[IgnoreRule]) -> callable:
    """
    Returns a closure `is_ignored(path: Path, is_dir: bool, extra_rules: Iterable[IgnoreRule]) -> bool`
    which evaluates rules in order: global -> root -> extra_rules (nearest-first inside traversal).
    Later matches override earlier matches.
    """
    base_rules = list(global_rules) + list(root_rules)

    def is_ignored(path: Path, is_dir: bool, extra_rules: Iterable[IgnoreRule]) -> bool:
        verdict = False
        # Evaluate in order; later rules win
        for rule in base_rules:
            if _match_rule(path, is_dir, rule):
                verdict = not rule.negation
        for rule in extra_rules:
            if _match_rule(path, is_dir, rule):
                verdict = not rule.negation
        return verdict

    return is_ignored

# --------------------------- Tree Writer ---------------------------

def iter_entries(path: Path, sort: str = "name"):
    try:
        entries = list(path.iterdir())
    except PermissionError:
        return []
    if sort == "type":
        entries.sort(key=lambda p: (not p.is_dir(), p.name.lower()))
    else:
        entries.sort(key=lambda p: p.name.lower())
    return entries

def build_tree(root: Path, is_ignored_fn, include_hidden: bool = False, follow_symlinks: bool = False,
               max_depth: Optional[int] = None, sort: str = "name",
               use_global_treeignore: bool = True) -> Tuple[str, int]:
    """
    Returns (tree_string, loaded_treeignore_files_count).
    """
    lines: List[str] = []
    treeignore_count = 0

    # Load global + root rules
    global_rules: List[IgnoreRule] = []
    if use_global_treeignore:
        script_dir = Path(__file__).resolve().parent
        gr = _read_treeignore_file(script_dir)

        # REBASE: apply global rules from the scan root
        for r in gr:
            r.base_dir = root
        global_rules.extend(gr)
        if gr:
            treeignore_count += 1

    root_rules = _read_treeignore_file(root)
    if root_rules:
        treeignore_count += 1

    # We'll maintain a stack of extra rules as we recurse (nearest directories last)
    lines.append(root.resolve().as_posix())

    def walk(dir_path: Path, prefix: str, depth: int, stacked_rules: List[IgnoreRule]):
        nonlocal treeignore_count

        if max_depth is not None and depth >= max_depth:
            return

        # Read .treeignore in this directory (except root which we already read)
        if dir_path != root:
            local_rules = _read_treeignore_file(dir_path)
            if local_rules:
                treeignore_count += 1
                stacked_rules = stacked_rules + local_rules  # later rules win
        # List children with visibility and ignore filters
        try:
            entries_all = iter_entries(dir_path, sort=sort)
        except Exception:
            entries_all = []

        entries = []
        for e in entries_all:
            if not include_hidden and e.name.startswith("."):
                continue
            try:
                e_is_dir = e.is_dir()
            except OSError:
                e_is_dir = False
            if is_ignored(e, e_is_dir, stacked_rules):
                continue
            entries.append(e)

        for idx, entry in enumerate(entries):
            try:
                is_dir = entry.is_dir()
            except OSError:
                is_dir = False

            connector = "└── " if idx == len(entries) - 1 else "├── "
            name = entry.name + ("/" if is_dir else "")
            lines.append(f"{prefix}{connector}{name}")

            if is_dir:
                # Avoid cycles via symlinks if not following
                try:
                    if entry.is_symlink() and not follow_symlinks:
                        continue
                except OSError:
                    pass
                new_prefix = f"{prefix}{'    ' if idx == len(entries) - 1 else '│   '}"
                walk(entry, new_prefix, depth + 1, stacked_rules)

    # Compose the is_ignored function bound to base rules
    is_ignored = make_is_ignored(global_rules, root_rules)

    # Start recursive walk
    walk(root, "", 0, [])

    return "\n".join(lines), treeignore_count

# --------------------------- Main ---------------------------

def load_config(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("Config JSON must be an object.")
    for key in ("root", "output_dir", "output_file"):
        if key not in data:
            raise KeyError(f"Missing required key '{key}' in config.")
    return data

def main():
    ap = argparse.ArgumentParser(description="Generate an ASCII file tree with layered .treeignore rules.")
    ap.add_argument("--config", required=True, help="Path to config.json")
    args = ap.parse_args()

    cfg = load_config(args.config)
    root = Path(cfg["root"]).expanduser().resolve()
    output_dir = Path(cfg["output_dir"]).expanduser().resolve()
    output_file = str(cfg["output_file"])

    include_hidden = bool(cfg.get("include_hidden", False))
    follow_symlinks = bool(cfg.get("follow_symlinks", False))
    max_depth = cfg.get("max_depth", None)
    if not isinstance(max_depth, int):
        max_depth = None
    sort = cfg.get("sort", "name")
    encoding = cfg.get("encoding", "utf-8")
    use_global_treeignore = bool(cfg.get("use_global_treeignore", True))

    if not root.exists() or not root.is_dir():
        raise SystemExit(f"Root path does not exist or is not a directory: {root}")

    # Dummy 'is_ignored_fn'; we bind actual base rules inside build_tree
    def placeholder(path, is_dir, extra_rules):
        return False

    tree_str, count_files = build_tree(
        root=root,
        is_ignored_fn=lambda p, d, extra: make_is_ignored(
            _read_treeignore_file(Path(__file__).resolve().parent) if use_global_treeignore else [],
            _read_treeignore_file(root)
        )(p, d, extra),
        include_hidden=include_hidden,
        follow_symlinks=follow_symlinks,
        max_depth=max_depth,
        sort=sort,
        use_global_treeignore=use_global_treeignore,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / output_file
    with open(out_path, "w", encoding=encoding, newline="\n") as f:
        f.write(tree_str)

    print(f"Wrote file tree to: {out_path}")
    print(f"Loaded .treeignore files: {count_files}")

if __name__ == "__main__":
    main()
