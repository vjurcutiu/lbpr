from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import re
from typing import Iterable, Literal
from xml.sax.saxutils import escape

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer

MarkdownExportFormat = Literal["markdown", "txt", "docx", "pdf"]


@dataclass(slots=True)
class ExportedArtifact:
    content: bytes
    file_name: str
    content_type: str
    format: MarkdownExportFormat


@dataclass(slots=True)
class MarkdownBlock:
    kind: Literal["heading", "paragraph", "bullet", "numbered"]
    text: str
    level: int = 0


def export_artifact(*, title: str, markdown: str, file_stem: str, target_format: MarkdownExportFormat) -> ExportedArtifact:
    normalized = _normalize_markdown(markdown)
    if target_format == "markdown":
        return ExportedArtifact(
            content=normalized.encode("utf-8"),
            file_name=f"{file_stem}.md",
            content_type="text/markdown; charset=utf-8",
            format=target_format,
        )

    blocks = _parse_markdown_blocks(normalized)
    if target_format == "txt":
        plain = _render_plain_text(blocks, fallback_title=title)
        return ExportedArtifact(
            content=plain.encode("utf-8"),
            file_name=f"{file_stem}.txt",
            content_type="text/plain; charset=utf-8",
            format=target_format,
        )
    if target_format == "docx":
        payload = _render_docx(title=title, blocks=blocks)
        return ExportedArtifact(
            content=payload,
            file_name=f"{file_stem}.docx",
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            format=target_format,
        )
    if target_format == "pdf":
        payload = _render_pdf(title=title, blocks=blocks)
        return ExportedArtifact(
            content=payload,
            file_name=f"{file_stem}.pdf",
            content_type="application/pdf",
            format=target_format,
        )
    raise ValueError(f"Unsupported artifact export format: {target_format}")


_INLINE_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
_INLINE_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")


def _normalize_markdown(markdown: str) -> str:
    text = str(markdown or "").replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00a0", " ")
    return text.strip()


def _strip_inline_markdown(text: str) -> str:
    clean = str(text or "")
    clean = _INLINE_IMAGE_RE.sub(lambda m: (m.group(1) or m.group(2) or "").strip(), clean)
    clean = _INLINE_LINK_RE.sub(lambda m: f"{m.group(1).strip()} ({m.group(2).strip()})", clean)
    clean = re.sub(r"`([^`]+)`", r"\1", clean)
    clean = re.sub(r"\*\*([^*]+)\*\*", r"\1", clean)
    clean = re.sub(r"__([^_]+)__", r"\1", clean)
    clean = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"\1", clean)
    clean = re.sub(r"(?<!_)_([^_]+)_(?!_)", r"\1", clean)
    clean = re.sub(r"~~([^~]+)~~", r"\1", clean)
    clean = re.sub(r"^>+\s?", "", clean)
    clean = re.sub(r"\s+", " ", clean)
    return clean.strip()


_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET_RE = re.compile(r"^[-*+]\s+(.*)$")
_NUMBERED_RE = re.compile(r"^\d+[.)]\s+(.*)$")


def _parse_markdown_blocks(markdown: str) -> list[MarkdownBlock]:
    blocks: list[MarkdownBlock] = []
    paragraph_lines: list[str] = []
    in_code_fence = False

    def flush_paragraph() -> None:
        if not paragraph_lines:
            return
        text = _strip_inline_markdown(" ".join(paragraph_lines))
        paragraph_lines.clear()
        if text:
            blocks.append(MarkdownBlock(kind="paragraph", text=text))

    for raw_line in markdown.split("\n"):
        line = raw_line.rstrip()
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code_fence = not in_code_fence
            flush_paragraph()
            continue
        if in_code_fence:
            if stripped:
                paragraph_lines.append(stripped)
            continue
        if not stripped:
            flush_paragraph()
            continue

        heading_match = _HEADING_RE.match(stripped)
        if heading_match:
            flush_paragraph()
            text = _strip_inline_markdown(heading_match.group(2))
            if text:
                blocks.append(MarkdownBlock(kind="heading", text=text, level=len(heading_match.group(1))))
            continue

        bullet_match = _BULLET_RE.match(stripped)
        if bullet_match:
            flush_paragraph()
            text = _strip_inline_markdown(bullet_match.group(1))
            if text:
                blocks.append(MarkdownBlock(kind="bullet", text=text))
            continue

        numbered_match = _NUMBERED_RE.match(stripped)
        if numbered_match:
            flush_paragraph()
            text = _strip_inline_markdown(numbered_match.group(1))
            if text:
                blocks.append(MarkdownBlock(kind="numbered", text=text))
            continue

        tableish = stripped.startswith("|") and stripped.endswith("|")
        if tableish:
            flush_paragraph()
            cells = [cell.strip() for cell in stripped.strip("|").split("|")]
            text = " | ".join(cell for cell in cells if cell and set(cell) != {"-"})
            text = _strip_inline_markdown(text)
            if text:
                blocks.append(MarkdownBlock(kind="paragraph", text=text))
            continue

        paragraph_lines.append(stripped)

    flush_paragraph()
    return blocks


def _render_plain_text(blocks: list[MarkdownBlock], *, fallback_title: str) -> str:
    if not blocks and fallback_title:
        return fallback_title.strip()

    lines: list[str] = []
    for idx, block in enumerate(blocks):
        if block.kind == "heading":
            text = block.text.strip()
            lines.append(text)
            if block.level <= 2:
                underline = "=" if block.level == 1 else "-"
                lines.append(underline * len(text))
        elif block.kind == "bullet":
            lines.append(f"- {block.text}")
        elif block.kind == "numbered":
            lines.append(f"1. {block.text}")
        else:
            lines.append(block.text)
        if idx < len(blocks) - 1:
            lines.append("")
    return "\n".join(lines).strip()


def _apply_doc_styles(document: Document) -> None:
    section = document.sections[0]
    section.top_margin = Inches(0.75)
    section.bottom_margin = Inches(0.75)
    section.left_margin = Inches(0.75)
    section.right_margin = Inches(0.75)
    section.start_type = WD_SECTION.NEW_PAGE

    normal_style = document.styles["Normal"]
    normal_style.font.name = "Arial"
    normal_style.font.size = Pt(10.5)

    for style_name, size, bold in [
        ("Title", 18, True),
        ("Heading 1", 14, True),
        ("Heading 2", 12, True),
        ("Heading 3", 11, True),
    ]:
        style = document.styles[style_name]
        style.font.name = "Arial"
        style.font.size = Pt(size)
        style.font.bold = bold


def _render_docx(*, title: str, blocks: list[MarkdownBlock]) -> bytes:
    document = Document()
    _apply_doc_styles(document)
    document.core_properties.title = title

    if not blocks:
        para = document.add_paragraph(title.strip() or "Workflow output")
        para.style = document.styles["Title"]
    else:
        title_added = False
        for block in blocks:
            if block.kind == "heading":
                level = max(0, min(block.level, 3))
                para = document.add_paragraph(block.text)
                para.style = document.styles["Title" if level == 0 else f"Heading {level}"]
                para.alignment = WD_ALIGN_PARAGRAPH.LEFT
                title_added = True if level == 0 else title_added
            elif block.kind == "bullet":
                para = document.add_paragraph(block.text, style="List Bullet")
                para.alignment = WD_ALIGN_PARAGRAPH.LEFT
            elif block.kind == "numbered":
                para = document.add_paragraph(block.text, style="List Number")
                para.alignment = WD_ALIGN_PARAGRAPH.LEFT
            else:
                para = document.add_paragraph(block.text)
                para.alignment = WD_ALIGN_PARAGRAPH.LEFT
        if not title_added and title.strip():
            first = document.paragraphs[0]
            first.insert_paragraph_before(title.strip(), style="Title")

    handle = BytesIO()
    document.save(handle)
    return handle.getvalue()


def _escape_pdf_text(text: str) -> str:
    return escape(text).replace("\n", "<br/>")


def _build_pdf_story(blocks: Iterable[MarkdownBlock]) -> list[object]:
    styles = getSampleStyleSheet()
    normal = ParagraphStyle(
        "WorkflowNormal",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        spaceAfter=8,
        alignment=TA_LEFT,
    )
    headings = {
        1: ParagraphStyle("WorkflowH1", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=colors.black, spaceAfter=10),
        2: ParagraphStyle("WorkflowH2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=colors.black, spaceAfter=8),
        3: ParagraphStyle("WorkflowH3", parent=styles["Heading3"], fontName="Helvetica-Bold", fontSize=11, leading=15, textColor=colors.black, spaceAfter=6),
    }

    story: list[object] = []
    pending_bullets: list[tuple[str, str]] = []

    def flush_list() -> None:
        nonlocal pending_bullets
        if not pending_bullets:
            return
        ordered = pending_bullets[0][0] == "numbered"
        list_items = [
            ListItem(Paragraph(_escape_pdf_text(text), normal), leftIndent=12)
            for _, text in pending_bullets
        ]
        story.append(ListFlowable(list_items, bulletType="1" if ordered else "bullet", start="1", leftIndent=16))
        story.append(Spacer(1, 0.08 * inch))
        pending_bullets = []

    for block in blocks:
        if block.kind in {"bullet", "numbered"}:
            kind = block.kind
            if pending_bullets and pending_bullets[0][0] != kind:
                flush_list()
            pending_bullets.append((kind, block.text))
            continue

        flush_list()
        if block.kind == "heading":
            style = headings.get(min(max(block.level, 1), 3), headings[3])
            story.append(Paragraph(_escape_pdf_text(block.text), style))
            story.append(Spacer(1, 0.04 * inch))
        else:
            story.append(Paragraph(_escape_pdf_text(block.text), normal))
    flush_list()
    return story


def _render_pdf(*, title: str, blocks: list[MarkdownBlock]) -> bytes:
    handle = BytesIO()
    doc = SimpleDocTemplate(
        handle,
        pagesize=A4,
        title=title,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
    )
    story = _build_pdf_story(blocks)
    if not story:
        styles = getSampleStyleSheet()
        story = [Paragraph(_escape_pdf_text(title or "Workflow output"), styles["Title"])]
    doc.build(story)
    return handle.getvalue()
