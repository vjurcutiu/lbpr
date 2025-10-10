import argparse
import subprocess
import sys
from pathlib import Path


def run(cmd):
    """Run a shell command and return the completed process."""
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dir", default="patches", help="Folder (root) containing .patch files, searched recursively")
    p.add_argument("--reverse", action="store_true", help="Reverse apply patches")
    p.add_argument("--check", action="store_true", help="Dry run only (check if patches apply cleanly)")
    args = p.parse_args()

    folder = Path(args.dir)
    patches = sorted(folder.rglob("*.patch"))
    if not patches:
        print(f"No patches found in {folder}")
        sys.exit(1)

    print(f"Found {len(patches)} patch(es) under {folder}")

    def git_apply(check=False):
        """Apply patches using git apply only."""
        for pf in patches:
            cmd = ["git", "apply"]
            if args.reverse:
                cmd.append("-R")
            if check:
                cmd.append("--check")
            cmd.append(str(pf))
            r = run(cmd)
            if r.returncode != 0:
                print(f"[git apply] FAILED on {pf}:\n{r.stderr}")
                return False
            print(f"[git apply] {'CHECK ' if check else ''}OK: {pf}")
        return True

    # Check first if all patches apply cleanly
    if not git_apply(check=True):
        sys.exit(1)

    if args.check:
        print("✅ All patches would apply cleanly (git).")
        sys.exit(0)

    # Apply for real
    if not git_apply(check=False):
        sys.exit(1)

    print("✅ All patches applied successfully (git).")


if __name__ == "__main__":
    main()
