# features/profile/models.py
from pydantic import BaseModel
from typing import Optional

class ProfileOut(BaseModel):
    uid: str
    email: Optional[str] = None
    name: Optional[str] = None
    picture: Optional[str] = None

class UpdateProfileIn(BaseModel):
    name: Optional[str] = None
    picture: Optional[str] = None
