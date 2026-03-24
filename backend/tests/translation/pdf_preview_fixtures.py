from __future__ import annotations

import fitz


def build_preview_pdf_bytes(
    title: str = "Preview Test",
    body: str = "This PDF preview contains text, layout, and vector marks.",
) -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 88), title, fontsize=22)
    page.draw_rect((72, 120, 523, 220), color=(0.2, 0.55, 0.95), fill=(0.9, 0.96, 1))
    page.insert_textbox((92, 140, 503, 205), body, fontsize=14, lineheight=1.4)
    page.draw_line((72, 252), (523, 252), color=(0.85, 0.65, 0.2), width=2)
    page.insert_text((72, 290), "Figure-like block", fontsize=14)
    page.draw_circle((170, 380), 48, color=(0.25, 0.8, 0.55), fill=(0.84, 0.98, 0.92))
    page.draw_rect((250, 330, 490, 430), color=(0.9, 0.4, 0.35), fill=(1, 0.93, 0.92))
    page.insert_textbox(
        (72, 470, 523, 700),
        "Second block of text to ensure the canvas is visibly rendered and not blank.",
        fontsize=12,
        lineheight=1.5,
    )
    return doc.tobytes()


def build_multi_page_preview_pdf_bytes(pages: list[tuple[str, str]]) -> bytes:
    doc = fitz.open()
    for index, (title, body) in enumerate(pages, start=1):
        page = doc.new_page(width=595, height=842)
        page.insert_text((72, 88), title, fontsize=22)
        page.draw_rect(
            (72, 120, 523, 220), color=(0.2, 0.55, 0.95), fill=(0.9, 0.96, 1)
        )
        page.insert_textbox((92, 140, 503, 205), body, fontsize=14, lineheight=1.4)
        page.draw_line((72, 252), (523, 252), color=(0.85, 0.65, 0.2), width=2)
        page.insert_text((72, 290), f"Page {index} figure block", fontsize=14)
        page.draw_circle(
            (170, 380), 48, color=(0.25, 0.8, 0.55), fill=(0.84, 0.98, 0.92)
        )
        page.draw_rect(
            (250, 330, 490, 430), color=(0.9, 0.4, 0.35), fill=(1, 0.93, 0.92)
        )
        page.insert_textbox(
            (72, 470, 523, 700),
            f"Page {index} extra layout content for visible PDF rendering.",
            fontsize=12,
            lineheight=1.5,
        )
    return doc.tobytes()
