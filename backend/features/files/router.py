
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
        log.info("files_list_request", user_uid=user.uid, client=str(getattr(request, "client", "")), ua=_hdr(request, "user-agent"))
        out = service.list_files(user.uid)
        log.info("files_list_ok", count=len(out), user_uid=user.uid)
        return out
    except Exception as e:
        log.exception("files_list_error")
        raise HTTPException(status_code=400, detail=str(e))

@router.post("", response_model=UploadResponse, status_code=202)
async def create_file(
    file: UploadFile = File(...),
    dataset: str = "default",
    user: SessionOut = Depends(get_current_user),
):
    """Upload a single file into user-based storage and auto-ingest to the user's RAG namespace."""
    try:
        log.info("files_upload_request", user_uid=user.uid, filename=getattr(file, "filename", None), ctype=getattr(file, "content_type", None))
        resp = await service.upload_file(user.uid, file, dataset=dataset)
        log.info("files_upload_ok", job_id=resp.job_id, user_uid=user.uid)
        return resp
    except ValueError as ve:
        log.warning("files_upload_rejected", reason=str(ve))
        raise HTTPException(status_code=413, detail=str(ve))
    except Exception as e:
        log.exception("files_upload_error")
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
        log.info("files_batch_upload_request", user_uid=user.uid, count=len(files), dataset=dataset)
        for f in files:
            try:
                resp = await service.upload_file(user.uid, f, dataset=dataset)
                jobs.append(resp.job_id)
                log.info("files_batch_upload_item_ok", job_id=resp.job_id, filename=getattr(f, "filename", None))
            except ValueError as ve:
                log.warning("files_batch_upload_item_rejected", filename=getattr(f, "filename", None), reason=str(ve))
                raise HTTPException(status_code=413, detail=str(ve))
            except Exception as e:
                log.exception("files_batch_upload_item_error", filename=getattr(f, "filename", None))
                raise HTTPException(status_code=400, detail=f"Failed to upload {getattr(f, 'filename', 'file')}")
        log.info("files_batch_upload_ok", user_uid=user.uid, jobs=len(jobs))
        return UploadBatchResponse(jobs=jobs)
    except HTTPException:
        raise
    except Exception as e:
        log.exception("files_batch_upload_error")
        raise HTTPException(status_code=400, detail=str(e))

# IMPORTANT: keep download route before catch-all {file_id:path}
@router.get("/{file_id:path}/download")
async def download_file(file_id: str, request: Request, user: SessionOut = Depends(get_current_user)):
    try:
        log.info("files_download_request", file_id=file_id, referer=_hdr(request, "referer"), ua=_hdr(request, "user-agent"), user_uid=user.uid)
        url = service.get_signed_download_url(file_id)
        log.info("files_download_redirect", file_id=file_id, signed_url_len=len(url) if url else 0)
        return RedirectResponse(url)
    except FileNotFoundError:
        log.warning("files_download_not_found", file_id=file_id)
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        log.exception("files_download_error")
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{file_id:path}")
async def get_file(file_id: str, request: Request, user: SessionOut = Depends(get_current_user)):
    """Return raw file bytes with correct Content-Type for inline preview."""
    try:
        log.info("files_get_request", file_id=file_id, accept=_hdr(request, "accept"), referer=_hdr(request, "referer"), user_uid=user.uid)
        data, content_type = service.get_file_bytes(file_id)
        log.info("files_get_ok", file_id=file_id, content_type=content_type, bytes=len(data))
        return Response(content=data, media_type=content_type)
    except FileNotFoundError:
        log.warning("files_get_not_found", file_id=file_id)
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        log.exception("files_get_error")
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{file_id:path}", response_model=DeleteResponse)
async def delete_file(file_id: str, request: Request, user: SessionOut = Depends(get_current_user)):
    try:
        log.info("files_delete_request", file_id=file_id, user_uid=user.uid)
        ok = service.delete_file(file_id)
        if not ok:
            log.warning("files_delete_not_found", file_id=file_id)
            raise HTTPException(status_code=404, detail="File not found")
        log.info("files_delete_ok", file_id=file_id)
        return DeleteResponse(ok=True)
    except HTTPException:
        raise
    except Exception as e:
        log.exception("files_delete_error")
        raise HTTPException(status_code=400, detail=str(e))

# Query-string variants (useful if proxies mangle %2F)
@router.get("/by-id")
async def get_file_by_id(id: str = Query(..., description="Exact object path as returned by list_files().id"), user: SessionOut = Depends(get_current_user)):
    try:
        log.info("files_get_by_id_request", id=id, user_uid=user.uid)
        data, content_type = service.get_file_bytes(id)
        log.info("files_get_by_id_ok", id=id, content_type=content_type, bytes=len(data))
        return Response(content=data, media_type=content_type)
    except FileNotFoundError:
        log.warning("files_get_by_id_not_found", id=id)
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        log.exception("files_get_by_id_error")
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/download/by-id")
async def download_file_by_id(id: str = Query(..., description="Exact object path as returned by list_files().id"), user: SessionOut = Depends(get_current_user)):
    try:
        log.info("files_download_by_id_request", id=id, user_uid=user.uid)
        url = service.get_signed_download_url(id)
        log.info("files_download_by_id_redirect", id=id, signed_url_len=len(url) if url else 0)
        return RedirectResponse(url)
    except FileNotFoundError:
        log.warning("files_download_by_id_not_found", id=id)
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        log.exception("files_download_by_id_error")
        raise HTTPException(status_code=400, detail=str(e))
