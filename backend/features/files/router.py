
from __future__ import annotations

from typing import Optional, List
import logging
from fastapi import APIRouter, File, UploadFile, HTTPException, Query, Request, Depends
from fastapi.responses import RedirectResponse, Response

from .schemas import FileItem, UploadResponse, UploadBatchResponse, DeleteResponse
from . import service

# Auth deps
try:
    from features.auth.deps import get_current_user  # type: ignore
    from features.auth.models import SessionOut  # type: ignore
except Exception:  # fallback for local/dev
    def get_current_user():
        class _U: uid = "dev"
        return _U()  # type: ignore
    class SessionOut:  # type: ignore
        uid: str = "dev"

router = APIRouter(prefix="/v1/files", tags=["Files"])
log = logging.getLogger("files.router")

def _hdr(request: Request, name: str) -> str | None:
    try:
        return request.headers.get(name)
    except Exception:
        return None

@router.get("", response_model=list[FileItem])
async def list_files(request: Request, user: SessionOut = Depends(get_current_user)):
    """List files for the *current user* using user-based namespaces."""
    try:

        out = service.list_files(user.uid)

        return out
    except Exception as e:

        raise HTTPException(status_code=400, detail=str(e))

@router.post("", response_model=UploadResponse, status_code=202)
async def create_file(
    file: UploadFile = File(...),
    dataset: str = "default",
    user: SessionOut = Depends(get_current_user),
):
    """Upload a single file into user-based storage and auto-ingest to the user's RAG namespace."""
    try:

        resp = await service.upload_file(user.uid, file, dataset=dataset)

        return resp
    except ValueError as ve:

        raise HTTPException(status_code=413, detail=str(ve))
    except Exception as e:

        raise HTTPException(status_code=400, detail=str(e))

@router.post("/batch", response_model=UploadBatchResponse, status_code=202)
async def create_files_batch(
    files: List[UploadFile] = File(...),
    dataset: str = "default",
    user: SessionOut = Depends(get_current_user),
):
    """Upload **multiple** files in one request. Frontend should append each file under the key 'files'."""
    jobs: List[str] = []
    try:
        if not files:
            raise HTTPException(status_code=400, detail="No files provided")

        for f in files:
            try:
                resp = await service.upload_file(user.uid, f, dataset=dataset)
                jobs.append(resp.job_id)

            except ValueError as ve:

                raise HTTPException(status_code=413, detail=str(ve))
            except Exception as e:

                raise HTTPException(status_code=400, detail=f"Failed to upload {getattr(f, 'filename', 'file')}")

        return UploadBatchResponse(jobs=jobs)
    except HTTPException:
        raise
    except Exception as e:

        raise HTTPException(status_code=400, detail=str(e))

# IMPORTANT: keep download route before catch-all {file_id:path}
@router.get("/{file_id:path}/download")
async def download_file(file_id: str, request: Request, user: SessionOut = Depends(get_current_user)):
    try:

        url = service.get_signed_download_url(file_id)

        return RedirectResponse(url)
    except FileNotFoundError:

        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:

        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{file_id:path}")
async def get_file(file_id: str, request: Request, user: SessionOut = Depends(get_current_user)):
    """Return raw file bytes with correct Content-Type for inline preview."""
    try:

        data, content_type = service.get_file_bytes(file_id)

        return Response(content=data, media_type=content_type)
    except FileNotFoundError:

        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:

        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{file_id:path}", response_model=DeleteResponse)
async def delete_file(file_id: str, request: Request, user: SessionOut = Depends(get_current_user)):
    try:

        ok = service.delete_file(file_id)
        if not ok:

            raise HTTPException(status_code=404, detail="File not found")

        return DeleteResponse(ok=True)
    except HTTPException:
        raise
    except Exception as e:

        raise HTTPException(status_code=400, detail=str(e))

# Query-string variants (useful if proxies mangle %2F)
@router.get("/by-id")
async def get_file_by_id(id: str = Query(..., description="Exact object path as returned by list_files().id"), user: SessionOut = Depends(get_current_user)):
    try:

        data, content_type = service.get_file_bytes(id)

        return Response(content=data, media_type=content_type)
    except FileNotFoundError:

        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:

        raise HTTPException(status_code=400, detail=str(e))

@router.get("/download/by-id")
async def download_file_by_id(id: str = Query(..., description="Exact object path as returned by list_files().id"), user: SessionOut = Depends(get_current_user)):
    try:

        url = service.get_signed_download_url(id)

        return RedirectResponse(url)
    except FileNotFoundError:

        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:

        raise HTTPException(status_code=400, detail=str(e))
