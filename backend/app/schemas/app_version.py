"""App version schemas"""

from pydantic import BaseModel


class AppUpdateResponse(BaseModel):
    """Available app update metadata"""

    version: str
    release_url: str


class AppVersionResponse(BaseModel):
    """Installed app version and available update metadata"""

    version: str
    update: AppUpdateResponse | None = None
