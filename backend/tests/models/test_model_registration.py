"""Guard test ensuring every model module reaches the shared metadata"""

import json
import re
import subprocess
import sys
from pathlib import Path

import app.models

_MODELS_DIR = Path(app.models.__file__).parent
_BACKEND_DIR = _MODELS_DIR.parents[1]

# Matches the table name a model declares, so the expectation is read from the source
# rather than from an import this test performs itself
_TABLENAME_PATTERN = re.compile(r'^\s*__tablename__\s*=\s*"([^"]+)"', re.MULTILINE)

# Prints the tables import_all_models registers, as JSON for the assertion to compare
_REGISTERED_TABLES_SCRIPT = (
    "import json;"
    "from app.models import import_all_models;"
    "from app.models.base import Base;"
    "import_all_models();"
    "print(json.dumps(sorted(Base.metadata.tables)))"
)


def _declared_table_names() -> set[str]:
    """Return every table name declared across the model package source"""
    declared: set[str] = set()
    for module_path in _MODELS_DIR.glob("*.py"):
        declared.update(_TABLENAME_PATTERN.findall(module_path.read_text()))
    return declared


def _registered_table_names() -> set[str]:
    """Return the tables import_all_models registers, read from a clean interpreter

    A subprocess is what makes this meaningful. Pytest imports every test module during
    collection, so in this process the model modules are already imported by whatever
    else needed them, and a gap in import_all_models would be invisible
    """
    completed = subprocess.run(  # noqa: S603
        [sys.executable, "-c", _REGISTERED_TABLES_SCRIPT],
        cwd=_BACKEND_DIR,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    return set(json.loads(completed.stdout))


def test_import_all_models_registers_every_declared_table():
    """Fail when a model module is left out, which would hide its tables from the metadata"""
    missing = _declared_table_names() - _registered_table_names()
    assert not missing, f"Tables declared in app/models but absent from the metadata: {sorted(missing)}"


def test_model_package_declares_at_least_one_table():
    """Fail when the source scan finds nothing, which would make the guard above vacuous"""
    assert _declared_table_names(), "No __tablename__ declarations found under app/models"
