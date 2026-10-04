"""Render LEARNING_GUIDE.md as a paginated PDF using ReportLab."""

from html import escape
from pathlib import Path
import re
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "LEARNING_GUIDE.md"
DESTINATION = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "LEARNING_GUIDE.pdf"
REPLACEMENTS = {
    "\u2014": " - ",
    "\u2013": " - ",
    "\u2192": "->",
    "\u20b9": "INR ",
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2022": "*",
}


def ascii_text(value: str) -> str:
    for source, replacement in REPLACEMENTS.items():
        value = value.replace(source, replacement)
    return value


def inline_markup(value: str) -> str:
    value = escape(ascii_text(value), quote=False)
    value = re.sub(r"`([^`]+)`", r'<font name="Courier" color="#526342">\1</font>', value)
    value = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", value)

    def link(match: re.Match[str]) -> str:
        label, target = match.group(1), escape(match.group(2), quote=True)
        return f'<link href="{target}" color="#52713b">{label}</link>'

    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, value)


def page_chrome(canvas, document) -> None:
    canvas.saveState()
    width, _height = A4
    canvas.setStrokeColor(colors.HexColor("#d8dfd1"))
    canvas.setLineWidth(.5)
    canvas.line(18 * mm, 14 * mm, width - 18 * mm, 14 * mm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#64705f"))
    canvas.drawString(18 * mm, 9 * mm, "ROHIT AI STUDIO - PROJECT GUIDE")
    canvas.drawRightString(width - 18 * mm, 9 * mm, str(document.page))
    canvas.restoreState()


def make_styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="GuideTitle", parent=styles["Title"], fontName="Helvetica-Bold",
        fontSize=24, leading=29, alignment=TA_CENTER, textColor=colors.HexColor("#172116"),
        spaceAfter=12,
    ))
    styles.add(ParagraphStyle(
        name="GuideSubtitle", parent=styles["Normal"], fontSize=10, leading=15,
        alignment=TA_CENTER, textColor=colors.HexColor("#65705f"), spaceAfter=16,
    ))
    styles.add(ParagraphStyle(
        name="GuideH2", parent=styles["Heading2"], fontName="Helvetica-Bold",
        fontSize=15, leading=19, textColor=colors.HexColor("#253221"),
        spaceBefore=12, spaceAfter=6, keepWithNext=True,
    ))
    styles.add(ParagraphStyle(
        name="GuideH3", parent=styles["Heading3"], fontName="Helvetica-Bold",
        fontSize=11, leading=14, textColor=colors.HexColor("#526a3c"),
        spaceBefore=8, spaceAfter=4, keepWithNext=True,
    ))
    styles.add(ParagraphStyle(
        name="GuideBody", parent=styles["BodyText"], fontSize=9.3, leading=13.2,
        textColor=colors.HexColor("#293128"), spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        name="GuideCode", parent=styles["Code"], fontName="Courier",
        fontSize=7.6, leading=10.4, backColor=colors.HexColor("#f2f5ed"),
        borderColor=colors.HexColor("#dbe3d4"), borderWidth=.5, borderPadding=7,
        leftIndent=5, rightIndent=5, spaceBefore=4, spaceAfter=8,
    ))
    styles.add(ParagraphStyle(
        name="GuideSmall", parent=styles["BodyText"], fontSize=7.8, leading=10.5,
        textColor=colors.HexColor("#31382f"),
    ))
    return styles


def is_table_separator(line: str) -> bool:
    cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def render() -> None:
    lines = SOURCE.read_text(encoding="utf-8").splitlines()
    styles = make_styles()
    story = []
    index = 0

    while index < len(lines):
        line = lines[index].strip()
        if not line:
            index += 1
            continue
        if line.startswith("```"):
            code = []
            index += 1
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code.append(ascii_text(lines[index]))
                index += 1
            story.append(Preformatted("\n".join(code), styles["GuideCode"], maxLineLength=105))
            index += 1
            continue
        if line.startswith("|"):
            table_lines = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                table_lines.append(lines[index].strip())
                index += 1
            rows = []
            for row in table_lines:
                if is_table_separator(row):
                    continue
                cells = [cell.strip() for cell in row.strip("|").split("|")]
                rows.append([Paragraph(inline_markup(cell), styles["GuideSmall"]) for cell in cells])
            if rows:
                table = Table(rows, repeatRows=1, hAlign="LEFT")
                table.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e7eddf")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#263321")),
                    ("GRID", (0, 0), (-1, -1), .35, colors.HexColor("#d3dccd")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]))
                story.extend([Spacer(1, 3), table, Spacer(1, 7)])
            continue
        if line.startswith("# "):
            story.append(Paragraph(inline_markup(line[2:]), styles["GuideTitle"]))
            index += 1
            continue
        if line.startswith("## "):
            story.append(Paragraph(inline_markup(line[3:]), styles["GuideH2"]))
            index += 1
            continue
        if line.startswith("### "):
            story.append(Paragraph(inline_markup(line[4:]), styles["GuideH3"]))
            index += 1
            continue
        if line.startswith("- "):
            items = []
            while index < len(lines) and lines[index].strip().startswith("- "):
                items.append(ListItem(Paragraph(inline_markup(lines[index].strip()[2:]), styles["GuideBody"]), leftIndent=10))
                index += 1
            story.append(ListFlowable(items, bulletType="bullet", start="circle", leftIndent=13, bulletFontSize=6, bulletColor=colors.HexColor("#719144")))
            story.append(Spacer(1, 3))
            continue
        if re.match(r"^\d+\.\s", line):
            items = []
            while index < len(lines) and re.match(r"^\d+\.\s", lines[index].strip()):
                text = re.sub(r"^\d+\.\s", "", lines[index].strip())
                items.append(ListItem(Paragraph(inline_markup(text), styles["GuideBody"]), leftIndent=10))
                index += 1
            story.append(ListFlowable(items, bulletType="1", start="1", leftIndent=18, bulletFontName="Helvetica-Bold", bulletFontSize=8))
            story.append(Spacer(1, 3))
            continue

        paragraph = [line]
        index += 1
        while index < len(lines):
            following = lines[index].strip()
            if not following or following.startswith(("#", "```", "|", "- ")) or re.match(r"^\d+\.\s", following):
                break
            paragraph.append(following)
            index += 1
        story.append(Paragraph(inline_markup(" ".join(paragraph)), styles["GuideBody"]))

    document = SimpleDocTemplate(
        str(DESTINATION), pagesize=A4,
        rightMargin=18 * mm, leftMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=21 * mm,
        title="Rohit AI Studio - Simple Project Guide",
        author="Rohit AI Studio",
    )
    document.build(story, onFirstPage=page_chrome, onLaterPages=page_chrome)
    print(f"Created {DESTINATION}")


if __name__ == "__main__":
    render()