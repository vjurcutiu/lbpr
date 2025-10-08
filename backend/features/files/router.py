from __future__ import annotations

from typing import Optional
import logging
from fastapi import APIRouter, File, UploadFile, Header, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, Response

from .schemas import FileItem, UploadResponse, DeleteResponse
from . import service

router = APIRouter(prefix="/v1/files", tags=["Files"])
log = logging.getLogger("files.router")

def _hdr(request: Request, name: str) -> str | None:
    try:
        return request.headers.get(name)
    except Exception:
        return None

@router.get("", response_model=list[FileItem])
def list_files(x_tenant_id: Optional[str] = Header(default=None, convert_underscores=False), request: Request = None):
    try:
        log.info("files_list_request", extra={
            "tenant": x_tenant_id or "demo",
            "client": str(getattr(request, "client", "")) if request else None,
            "ua": _hdr(request, "user-agent") if request else None,
        })
        out = service.list_files(x_tenant_id)
        log.info("files_list_ok", extra={"count": len(out), "tenant": x_tenant_id or "demo"})
        return out
    except Exception as e:
        log.exception("files_list_error")
        raise HTTPException(status_code=400, detail=str(e))

@router.post("", response_model=UploadResponse, status_code=202)
def create_file(
    file: UploadFile = File(...),
    x_tenant_id: Optional[str] = Header(default=None, convert_underscores=False),
    dataset: str = "default",
    request: Request = None,
):
    try:
        log.info("files_upload_request", extra={
            "tenant": x_tenant_id or "demo",
            "filename": getattr(file, "filename", None),
            "ctype": getattr(file, "content_type", None),
        })
        resp = service.upload_file(x_tenant_id, file, dataset=dataset)
        log.info("files_upload_ok", extra={"job_id": resp.job_id, "tenant": x_tenant_id or "demo"})
        return resp
    except ValueError as ve:
        log.warning("files_upload_rejected", extra={"reason": str(ve)})
        raise HTTPException(status_code=413, detail=str(ve))
    except Exception as e:
        log.exception("files_upload_error")
        raise HTTPException(status_code=400, detail=str(e))

# IMPORTANT: order matters in FastAPI. The more specific route must appear BEFORE the catch-all {file_id:path}.
# Put the download variant first so it doesn't get swallowed by the generic get_file route below.

@router.get("/{file_id:path}/download")
def download_file(file_id: str, request: Request):
    try:
        log.info("files_download_request", extra={
            "file_id": file_id,
            "referer": _hdr(request, "referer"),
            "ua": _hdr(request, "user-agent"),
        })
        url = service.get_signed_download_url(file_id)
        log.info("files_download_redirect", extra={
            "file_id": file_id,
            "signed_url_len": len(url) if url else 0,
        })
        return RedirectResponse(url)
    except FileNotFoundError:
        log.warning("files_download_not_found", extra={"file_id": file_id})
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        log.exception("files_download_error")
        raise HTTPException(status_code=400, detail=str(e))

# --- Path-based inline preview (catch-all) ---
@router.get("/{file_id:path}")
def get_file(file_id: str, request: Request):
    """Return raw file bytes with correct Content-Type for inline preview."""
    try:
        log.info("files_get_request", extra={
            "file_id": file_id,
            "accept": _hdr(request, "accept"),
            "referer": _hdr(request, "referer"),
        })
        data, content_type = service.get_file_bytes(file_id)
        log.info("files_get_ok", extra={"file_id": file_id, "content_type": content_type, "bytes": len(data)})
        return Response(content=data, media_type=content_type)
    except FileNotFoundError:
        log.warning("files_get_not_found", extra={"file_id": file_id})
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        log.exception("files_get_error")
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{file_id:path}", response_model=DeleteResponse)
def delete_file(file_id: str, x_tenant_id: Optional[str] = Header(default=None, convert_underscores=False), request: Request = None):
    try:
        log.info("files_delete_request", extra={
            "file_id": file_id,
            "tenant": x_tenant_id or "demo",
        })
        ok = service.delete_file(x_tenant_id, file_id)
        if not ok:
            log.warning("files_delete_not_found", extra={"file_id": file_id})
            raise HTTPException(status_code=404, detail="File not found")
        log.info("files_delete_ok", extra={"file_id": file_id})
        return DeleteResponse(ok=True)
    except HTTPException:
        raise
    except Exception as e:
        log.exception("files_delete_error")
        raise HTTPException(status_code=400, detail=str(e))

# --- Query-string variants (robust when proxies mangle %2F) ---

@router.get("/by-id")
def get_file_by_id(id: str = Query(..., description="Exact object path as returned by list_files().id"), request: Request = None):
    """Safer variant that uses a query string so proxies won't touch encoded slashes."""
    try:
        log.info("files_get_by_id_request", extra={"id": id})
        data, content_type = service.get_file_bytes(id)
        log.info("files_get_by_id_ok", extra={"id": id, "content_type": content_type, "bytes": len(data)})
        return Response(content=data, media_type=content_type)
    except FileNotFoundError:
        log.warning("files_get_by_id_not_found", extra={"id": id})
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        log.exception("files_get_by_id_error")
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/download/by-id")
def download_file_by_id(id: str = Query(..., description="Exact object path as returned by list_files().id"), request: Request = None):
    try:
        log.info("files_download_by_id_request", extra={"id": id})
        url = service.get_signed_download_url(id)
        log.info("files_download_by_id_redirect", extra={"id": id, "signed_url_len": len(url) if url else 0})
        return RedirectResponse(url)
    except FileNotFoundError:
        log.warning("files_download_by_id_not_found", extra={"id": id})
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        log.exception("files_download_by_id_error")
        raise HTTPException(status_code=400, detail=str(e))
