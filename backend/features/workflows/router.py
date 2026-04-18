from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from features.auth.deps import get_current_user
from features.auth.models import SessionOut

from .models import WorkflowManifest, WorkflowRun, WorkflowRunCreate, WorkflowRunList
from . import service

router = APIRouter(prefix="/v1/workflows", tags=["workflows"])


@router.get("", response_model=list[WorkflowManifest])
def list_workflows(user: SessionOut = Depends(get_current_user)) -> list[WorkflowManifest]:
    return service.list_workflows()


@router.get("/runs", response_model=WorkflowRunList)
def list_workflow_runs(
    limit: int = Query(10, ge=1, le=50),
    user: SessionOut = Depends(get_current_user),
) -> WorkflowRunList:
    return service.list_runs(user.uid, limit=limit)


@router.post("/runs", response_model=WorkflowRun)
def create_workflow_run(payload: WorkflowRunCreate, user: SessionOut = Depends(get_current_user)) -> WorkflowRun:
    return service.create_run(user.uid, payload)


@router.get("/runs/{run_id}", response_model=WorkflowRun)
def get_workflow_run(run_id: str, user: SessionOut = Depends(get_current_user)) -> WorkflowRun:
    return service.get_run(user.uid, run_id)
