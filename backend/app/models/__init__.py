"""SQLAlchemy model package"""

import importlib
import pkgutil


def import_all_models() -> None:
    """Import every model module so the metadata holds the full schema

    Alembic autogenerate, the test schema build, the seed scripts and the encrypted column
    discovery all read the metadata, and a model module nothing imports is absent from it.
    Walking the package is what keeps a new model file from having to be added to a
    separate list in each of them, where one list omitting it goes unnoticed
    """
    for module in pkgutil.iter_modules(__path__):
        importlib.import_module(f"{__name__}.{module.name}")
