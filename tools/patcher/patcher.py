import argparse, subprocess, sys
from pathlib import Path

def run(cmd):
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dir", default="patches", help="Folder with .patch files")
    p.add_argument("--reverse", action="store_true", help="Reverse apply")
    p.add_argument("--check", action="store_true", help="Dry run only")
    args = p.parse_args()

    folder = Path(args.dir)
    patches = sorted(folder.glob("*.patch"))
    if not patches:
        print(f"No patches found in {folder}")
        sys.exit(1)

    # Use git apply if repo; fall back to patch
    def try_git_apply(check=False):
        for pf in patches:
            cmd = ["git", "apply"]
            if args.reverse: cmd.append("-R")
            if check: cmd.append("--check")
            cmd.append(str(pf))
            r = run(cmd)
            if r.returncode != 0:
                print(f"[git apply] FAILED on {pf}:\n{r.stderr}")
                return False
            print(f"[git apply] {'CHECK ' if check else ''}OK: {pf}")
        return True

    def do_patch(check=False):
        # patch(1) doesn’t have a true global dry-run; we simulate with --dry-run
        # on each file
        for pf in patches:
            cmd = ["patch", "-p1"]
            if args.reverse: cmd.append("-R")
            if check: cmd.append("--dry-run")
            r = run(cmd + ["-i", str(pf)])
            if r.returncode != 0:
                print(f"[patch] FAILED on {pf}:\n{r.stderr}")
                return False
            print(f"[patch] {'CHECK ' if check else ''}OK: {pf}")
        return True

    # Prefer git apply
    if try_git_apply(check=True):
        if args.check:
            print("All patches would apply cleanly (git).")
            sys.exit(0)
        if not try_git_apply(check=False):
            sys.exit(1)
        print("All patches applied (git).")
        return

    # Fallback to patch
    print("git apply failed in check mode; trying patch(1)...")
    if not do_patch(check=True):
        sys.exit(1)
    if args.check:
        print("All patches would apply cleanly (patch).")
        sys.exit(0)
    if not do_patch(check=False):
        sys.exit(1)
    print("All patches applied (patch).")

if __name__ == "__main__":
    main()
