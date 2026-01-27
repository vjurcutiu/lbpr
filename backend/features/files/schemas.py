from __future__ import annotations

from typing import Optional, List
from pydantic import BaseModel, Field


class FileItem(BaseModel):
    id: str
    name: str
    size: int
    created_at: Optional[str] = None
    content_type: Optional[str] = None

    # Folder support (Phase 1–3). Optional so older clients don't break.
    folder_path: Optional[str] = None
    original_name: Optional[str] = None


class UploadResponse(BaseModel):
    job_id: str


class UploadBatchResponse(BaseModel):
    jobs: List[str]


class DeleteResponse(BaseModel):
    ok: bool = True


class DeleteFolderResponse(BaseModel):
    ok: bool = True
    deleted_files: int = 0
    deleted_folders: int = 0
    deleted_markers: int = 0


class FolderItem(BaseModel):
    path: str
    name: str
    parent_path: Optional[str] = None
    created_at: Optional[str] = None


class CreateFolderRequest(BaseModel):
    path: str = Field(..., description="Folder path like 'clients/acme'")


class CreateFolderResponse(BaseModel):
    ok: bool = True
    folder: FolderItem


class UpdateFileRequest(BaseModel):
    # If multiple are provided, display_name wins, then folder/name.
    display_name: Optional[str] = Field(
        None,
        description="Full display path including filename, e.g. 'clients/acme/contract.pdf'",
    )
    folder: Optional[str] = Field(
        None,
        description="Destination folder path, e.g. 'clients/acme' (keeps current filename)",
    )
    name: Optional[str] = Field(
        None,
        description="New base filename (keeps current folder)",
    )
    dataset: Optional[str] = Field(None, description="Optional dataset override")


class UpdateFileResponse(BaseModel):
    ok: bool = True
    file: Optional[FileItem] = None
