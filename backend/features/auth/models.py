from pydantic import BaseModel
from typing import Optional

class SessionOut(BaseModel):
    uid: str
    email: Optional[str] = None
    name: Optional[str] = None
    picture: Optional[str] = None
    phone_number: Optional[str] = None
    email_verified: Optional[bool] = None

class EnvelopeOut(BaseModel):
    user: Optional[SessionOut] = None

class CreateSessionIn(BaseModel):
    id_token: str


class MagicCreateIn(BaseModel):
    """Admin request to create a one-time magic-link code.

    Provide either `uid` or `phone_number` (E.164) to target an existing Firebase user.
    """

    uid: Optional[str] = None
    phone_number: Optional[str] = None
    return_to: Optional[str] = None
    ttl_seconds: Optional[int] = None
    base_url: Optional[str] = None


class MagicCreateOut(BaseModel):
    code: str
    link: str
    expires_in_seconds: int


class MagicExchangeIn(BaseModel):
    code: str


class MagicExchangeOut(BaseModel):
    custom_token: str
