from pydantic import BaseModel
from typing import Optional

class SessionOut(BaseModel):
    uid: str
    email: Optional[str] = None
    name: Optional[str] = None
    picture: Optional[str] = None
    email_verified: Optional[bool] = None  # NEW

class EnvelopeOut(BaseModel):
    user: Optional[SessionOut] = None

class CreateSessionIn(BaseModel):
    id_token: str
