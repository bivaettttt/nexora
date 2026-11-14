import json
import sys
from pathlib import Path

from nexora.api import app
from nexora.source import billing, crm

for name, service in (("nexora", app), ("crm", crm), ("billing", billing)):
    path = Path(f"docs/api/{name}.openapi.json")
    source = (
        json.dumps(service.openapi(), sort_keys=True, indent=2, ensure_ascii=False)
        + "\n"
    )
    if "--check" in sys.argv:
        if path.read_text() != source:
            raise SystemExit(f"OpenAPI drift: {path}")
    else:
        path.write_text(source)
