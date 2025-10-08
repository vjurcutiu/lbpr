import {
  File as FileGeneric,
  FileCode,
  FileImage,
  FileAudio2,
  FileVideo2,
  FileArchive,
  FileSpreadsheet,
  FileType,
  FileText,
} from "lucide-react";

export function FileIconByName({ name, className }: { name: string; className?: string }) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const Icon =
    ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif" || ext === "svg"
      ? FileImage
      : ext === "mp3" || ext === "wav" || ext === "flac"
      ? FileAudio2
      : ext === "mp4" || ext === "mov" || ext === "webm"
      ? FileVideo2
      : ext === "zip" || ext === "gz" || ext === "rar" || ext === "7z"
      ? FileArchive
      : ext === "csv" || ext === "xlsx"
      ? FileSpreadsheet
      : ["ts","tsx","js","jsx","py","go","rs","java","json","yml","yaml","toml","md"].includes(ext)
      ? FileCode
      : ext === "txt"
      ? FileText
      : ext
      ? FileType
      : FileGeneric;
  return <Icon className={className} />;
}
