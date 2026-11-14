import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
tracked = (
    subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
)
secret = re.compile(
    rb"gh[pous]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----"
)
for name in (name for name in tracked if name):
    path = root / name
    if path.name.startswith(".env") and path.name != ".env.example":
        raise SystemExit(f"Environment file tracked: {name}")
    raw = path.read_bytes()
    if secret.search(raw):
        raise SystemExit(f"Suspected credential: {name}")
    if path.suffix == ".md":
        for link in re.findall(r"\]\(([^)]+)\)", raw.decode()):
            target = link.partition("#")[0]
            if target and "://" not in target and not (path.parent / target).exists():
                raise SystemExit(f"Broken link in {name}: {link}")
