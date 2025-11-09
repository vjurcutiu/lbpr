# File Compiler (v2)

**What's new**
- `folders`: non-recursive directories.
- `recurse_folders`: list of directories that are scanned recursively.
- Backward compatible: if `recurse_folders` is `true` (boolean), all `folders` are treated as recursive (legacy mode).
- `.compiler_ignore`: unchanged; applies to both modes.

## Example manifest
```json
{
  "output": "out/combined.txt",
  "folders": ["src", "scripts"],
  "recurse_folders": ["features", "packages"],
  "include_glob": ["*.py", "*.ts", "*.tsx", "*.js"],
  "exclude_glob": ["*.spec.ts", "*.test.tsx"],
  "dedup": "path"
}
```

## Usage
```bash
python file_compiler.py example_manifest.json
# or in batch
python file_compiler.py --batch --dir ./manifests
```
