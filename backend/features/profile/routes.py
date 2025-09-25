# features/profile/routes.py
from fastapi import APIRouter, Depends
from features.auth.deps import get_current_user
from features.auth.models import SessionOut
import os
from features.profile.models import ProfileOut, UpdateProfileIn
from features.profile.service import FirebaseProfileService, FakeProfileService, ProfileService

router = APIRouter(tags=["profile"])

def get_profile_service() -> ProfileService:
    if os.getenv("PYTEST_CURRENT_TEST") or os.getenv("AUTH_FAKE") == "1":
        return FakeProfileService()
    return FirebaseProfileService()

@router.get("/me", response_model=ProfileOut)
def read_me(user: SessionOut = Depends(get_current_user),
            svc: ProfileService = Depends(get_profile_service)) -> ProfileOut:
    # Always return current info from identity provider
    return svc.get(user.uid)

@router.patch("/me", response_model=ProfileOut)
def update_me(payload: UpdateProfileIn,
              user: SessionOut = Depends(get_current_user),
              svc: ProfileService = Depends(get_profile_service)) -> ProfileOut:
    return svc.update(user.uid, name=payload.name, picture=payload.picture)
