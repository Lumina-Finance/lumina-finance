"""Display preferences, shared by the profile and every auth response"""

from pydantic import BaseModel, ConfigDict

from app.preferences import DateFormat


class ProfilePreferences(BaseModel):
    """The display settings a profile stores

    Every subclass is built straight from a User row
    """

    model_config = ConfigDict(from_attributes=True)

    date_format: DateFormat
