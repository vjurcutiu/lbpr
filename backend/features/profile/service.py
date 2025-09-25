# features/profile/service.py
from __future__ import annotations
from typing import Optional, Protocol
from features.profile.models import ProfileOut

class ProfileService(Protocol):
    def get(self, uid: str) -> ProfileOut: ...
    def update(self, uid: str, *, name: Optional[str] = None, picture: Optional[str] = None) -> ProfileOut: ...

class FirebaseProfileService:
    def __init__(self):
        from firebase_admin import auth  # type: ignore
        self._auth = auth

    def get(self, uid: str) -> ProfileOut:
        u = self._auth.get_user(uid)
        return ProfileOut(
            uid=u.uid,
            email=(u.email or None),
            name=(u.display_name or None),
            picture=(u.photo_url or None),
        )

    def update(self, uid: str, *, name: Optional[str] = None, picture: Optional[str] = None) -> ProfileOut:
        kwargs = {}
        if name is not None:
            kwargs["display_name"] = name or None
        if picture is not None:
            kwargs["photo_url"] = picture or None
        if kwargs:
            self._auth.update_user(uid, **kwargs)
        # Return fresh copy
        return self.get(uid)

# Deterministic fake for tests/dev without Firebase
class FakeProfileService:
    _data: dict[str, ProfileOut] = {}

    def get(self, uid: str) -> ProfileOut:
        p = self._data.get(uid)
        if p:
            return p
        # Default user when first seen
        p = ProfileOut(uid=uid, email="test@example.com", name="Testy McTestface", picture=None)
        self._data[uid] = p
        return p

    def update(self, uid: str, *, name: Optional[str] = None, picture: Optional[str] = None) -> ProfileOut:
        p = self.get(uid)
        if name is not None:
            p.name = name or None
        if picture is not None:
            p.picture = picture or None
        self._data[uid] = p
        return p
