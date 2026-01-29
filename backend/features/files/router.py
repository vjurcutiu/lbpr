from __future__ import annotations

from typing import Optional, List
import logging

from fastapi import APIRouter, File, UploadFile, HTTPException, Query, Request, Depends
from fastapi.responses import RedirectResponse, Response

from .schemas import (
    FileItem,
    UploadResponse,
    UploadBatchResponse,
    DeleteResponse,
    FolderItem,
    CreateFolderRequest,
    CreateFolderResponse,
    MoveFolderRequest,
    MoveFolderResponse,
    UpdateFileRequest,
    UpdateFileResponse,
)
from . import service

# Auth deps
try:
    from features.auth.deps import get_current_user  # type: ignore
    from features.auth.models import SessionOut  # type: ignore
except Exception:  # fallback for local/dev
    def get_current_user():
        class _U:
            uid = "dev"
        return _U()  # type: ignore

    class SessionOut:  # type: ignore
        uid: str = "dev"


router = APIRouter(prefix="/v1/files", tags=["Files"])
log = logging.getLogger("files.router")


@router.get("", response_model=list[FileItem])
async def list_files(request: Request, user: SessionOut = Depends(get_current_user)):
    """List files for the *current user* using user-based namespaces."""
    try:
        return service.list_files(user.uid)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/folders", response_model=list[FolderItem])
async def list_folders(request: Request, user: SessionOut = Depends(get_current_user)):
    """List folders for the current user (includes empty folders via Firestore)."""
    try:
        return service.list_folders(user.uid)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/folders", response_model=CreateFolderResponse)
async def create_folder(req: CreateFolderRequest, user: SessionOut = Depends(get_current_user)):
    """Create a folder (virtual path)."""
    try:
        folder = service.create_folder(user.uid, req.path)
        return CreateFolderResponse(ok=True, folder=folder)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/folders/move", response_model=MoveFolderResponse)
async def move_folder(req: MoveFolderRequest, user: SessionOut = Depends(get_current_user)):
    """Move a folder (recursively) to a new parent path.

    This updates folder records and moves all files in the subtree by updating their metadata.
    """
    try:
        return service.move_folder(user.uid, req.src_path, req.dest_parent_path)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except PermissionError:
        raise HTTPException(status_code=403, detail="Forbidden")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Folder not found")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("", response_model=UploadResponse, status_code=202)
async def create_file(
    file: UploadFile = File(...),
    dataset: str = "default",
    folder: Optional[str] = Query(None, description="Optional folder path (virtual)"),
    user: SessionOut = Depends(get_current_user),
):
    """Upload a single file into user-based storage and auto-ingest to the user's RAG namespace."""
    try:
        return await service.upload_file(user.uid, file, dataset=dataset, folder=folder)
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=413, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/batch", response_model=UploadBatchResponse, status_code=202)
async def create_files_batch(
    files: List[UploadFile] = File(...),
    dataset: str = "default",
    folder: Optional[str] = Query(None, description="Optional folder path (virtual) for all files"),
    user: SessionOut = Depends(get_current_user),
):
    """Upload **multiple** files in one request. Frontend should append each file under the key 'files'."""
    jobs: List[str] = []
    try:
        if not files:
            raise HTTPException(status_code=400, detail="No files provided")

        for f in files:
            try:
                resp = await service.upload_file(user.uid, f, dataset=dataset, folder=folder)
                jobs.append(resp.job_id)
            except HTTPException:
                raise
            except ValueError as ve:
                raise HTTPException(status_code=413, detail=str(ve))
            except Exception:
                raise HTTPException(status_code=400, detail=f"Failed to upload {getattr(f, 'filename', 'file')}")

        return UploadBatchResponse(jobs=jobs)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# Query-string variants (useful if proxies mangle %2F)
@router.get("/by-id")
async def get_file_by_id(
    id: str = Query(..., description="Exact object path as returned by list_files().id"),
    user: SessionOut = Depends(get_current_user),
):
    try:
        data, content_type = service.get_file_bytes(user.uid, id)
        return Response(content=data, media_type=content_type)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Forbidden")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/download/by-id")
async def download_file_by_id(
    id: str = Query(..., description="Exact object path as returned by list_files().id"),
    user: SessionOut = Depends(get_current_user),
):
    try:
        url = service.get_signed_download_url(user.uid, id)
        return RedirectResponse(url)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Forbidden")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# IMPORTANT: keep download route before catch-all {file_id:path}
@router.get("/{file_id:path}/download")
async def download_file(file_id: str, request: Request, user: SessionOut = Depends(get_current_user)):
    try:
        url = service.get_signed_download_url(user.uid, file_id)
        return RedirectResponse(url)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Forbidden")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/{file_id:path}", response_model=UpdateFileResponse)
async def update_file(file_id: str, req: UpdateFileRequest, user: SessionOut = Depends(get_current_user)):
    try:
        updated = service.update_file(
            user.uid,
            file_id,
            display_name=req.display_name,
            folder=req.folder,
            name=req.name,
            dataset=req.dataset,
        )
        return UpdateFileResponse(ok=True, file=updated)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Forbidden")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{file_id:path}")
async def get_file(file_id: str, request: Request, user: SessionOut = Depends(get_current_user)):
    """Return raw file bytes with correct Content-Type for inline preview."""
    try:
        data, content_type = service.get_file_bytes(user.uid, file_id)
        return Response(content=data, media_type=content_type)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Forbidden")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{file_id:path}", response_model=DeleteResponse)
async def delete_file(file_id: str, request: Request, user: SessionOut = Depends(get_current_user)):
    try:
        ok = service.delete_file(user.uid, file_id)
        if not ok:
            raise HTTPException(status_code=404, detail="File not found")
        return DeleteResponse(ok=True)
    except HTTPException:
        raise
    except PermissionError:
        raise HTTPException(status_code=403, detail="Forbidden")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
