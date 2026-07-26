"""App version routes"""

from fastapi import APIRouter

from app.config.runtime import APP_VERSION
from app.schemas.app_version import AppVersionResponse
from app.services.app_version import get_available_update

router = APIRouter(prefix="/version", tags=["version"])


@router.get("", response_model=AppVersionResponse)
async def get_app_version():
    """Return app version metadata

    Returns:
        Installed version and available update metadata
    """
    update = await get_available_update()
    return AppVersionResponse(version=APP_VERSION, update=update)
