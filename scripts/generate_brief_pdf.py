from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / ".pydeps"))

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    md_path = repo_root / "docs" / "CURSOR_DEVELOPMENT_BRIEF.md"
    pdf_path = repo_root / "docs" / "CURSOR_DEVELOPMENT_BRIEF.pdf"

    text = md_path.read_text(encoding="utf-8")
    lines = text.splitlines()

    doc = SimpleDocTemplate(str(pdf_path), pagesize=letter)
    styles = getSampleStyleSheet()
    body = styles["BodyText"]
    heading = styles["Heading2"]

    story = []
    for line in lines:
      clean = line.strip()
      if not clean:
        story.append(Spacer(1, 8))
        continue

      if clean.startswith("## "):
        story.append(Paragraph(clean[3:], heading))
      elif clean.startswith("# "):
        story.append(Paragraph(f"<b>{clean[2:]}</b>", styles["Title"]))
      else:
        story.append(Paragraph(clean.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"), body))
      story.append(Spacer(1, 5))

    doc.build(story)
    print(f"Generated {pdf_path}")


if __name__ == "__main__":
    main()
