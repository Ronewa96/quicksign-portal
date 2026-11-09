"""Converts a PDF to an editable Word document with pdf2docx, keeping its layout, tables, and images.

Usage: python pdf_to_docx.py <input.pdf> <output.docx>
"""
import logging
import sys

from pdf2docx import Converter

logging.disable(logging.CRITICAL)  # pdf2docx logs progress for every page

def main() -> int:
    if len(sys.argv) != 3:
        print("usage: pdf_to_docx.py <input.pdf> <output.docx>", file=sys.stderr)
        return 2

    converter = Converter(sys.argv[1])
    try:
        converter.convert(sys.argv[2])
    finally:
        converter.close()
    return 0

if __name__ == "__main__":
    sys.exit(main())
