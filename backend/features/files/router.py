from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, File, UploadFile, Header, HTTPException, Query
from fastapi.responses import RedirectResponse, Response

from .schemas import FileItem, UploadResponse, DeleteResponse
from . import service

router = APIRouter(prefix="/v1/files", tags=["Files"])

@router.get("", response_model=list[FileItem])
def list_files(x_tenant_id: Optional[str] = Header(default=None, convert_underscores=False)):
    try:
        return service.list_files(x_tenant_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("", response_model=UploadResponse, status_code=202)
def create_file(
    file: UploadFile = File(...),
    x_tenant_id: Optional[str] = Header(default=None, convert_underscores=False),
    dataset: str = "default",
):
    try:
        return service.upload_file(x_tenant_id, file, dataset=dataset)
    except ValueError as ve:
        raise HTTPException(status_code=413, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# --- Path-based routes (work if proxy preserves encoded slashes) ---

@router.get("/{file_id:path}")
def get_file(file_id: str):
    """Return raw file bytes with correct Content-Type for inline preview."""
    try:
        data, content_type = service.get_file_bytes(file_id)
        return Response(content=data, media_type=content_type)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{file_id:path}/download")
def download_file(file_id: str):
    try:
        url = service.get_signed_download_url(file_id)
        return RedirectResponse(url)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{file_id:path}", response_model=DeleteResponse)
def delete_file(file_id: str, x_tenant_id: Optional[str] = Header(default=None, convert_underscores=False)):
    try:
        ok = service.delete_file(x_tenant_id, file_id)
        if not ok:
            raise HTTPException(status_code=404, detail="File not found")
        return DeleteResponse(ok=True)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# --- Query-string routes (robust when proxies mangle %2F) ---

@router.get("/by-id")
def get_file_by_id(id: str = Query(..., description="Exact object path as returned by list_files().id")):
    """Safer variant that uses a query string so proxies won't touch encoded slashes."""
    try:
        data, content_type = service.get_file_bytes(id)
        return Response(content=data, media_type=content_type)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/download/by-id")
def download_file_by_id(id: str = Query(..., description="Exact object path as returned by list_files().id")):
    try:
        url = service.get_signed_download_url(id)
        return RedirectResponse(url)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
