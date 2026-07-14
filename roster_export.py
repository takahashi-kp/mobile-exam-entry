from copy import copy
from datetime import date, datetime
from io import BytesIO
from pathlib import Path

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parent
TEMPLATES = {
    "chest": ROOT / "templates" / "chest-roster.xlsx",
    "stomach": ROOT / "templates" / "stomach-roster.xlsx",
}
MAX_ROSTER_ROWS = 993  # Template detail rows 8 through 1000.


def japanese_date(value):
    if isinstance(value, str):
        try:
            value = date.fromisoformat(value)
        except ValueError:
            value = date.today()
    if isinstance(value, datetime):
        value = value.date()
    if not isinstance(value, date):
        value = date.today()
    return f"{value.year}年{value.month}月{value.day}日"


def safe_text(value, limit=200):
    text = str(value or "").strip()[:limit]
    if text.startswith(("=", "+", "-", "@")):
        return f"'{text}"
    return text


def safe_age(value):
    try:
        age = int(value)
    except (TypeError, ValueError):
        return ""
    return age if 0 <= age <= 130 else ""


def copy_row_style(sheet, source_row, target_row, min_col=3, max_col=7):
    for col in range(min_col, max_col + 1):
        source = sheet.cell(source_row, col)
        target = sheet.cell(target_row, col)
        if source.has_style:
            target._style = copy(source._style)
        target.number_format = source.number_format
        target.alignment = copy(source.alignment)
        target.protection = copy(source.protection)


def build_roster(kind, customer_name, exam_date, rows):
    if kind not in TEMPLATES:
        raise ValueError("Unknown roster type")
    if not isinstance(rows, list):
        raise ValueError("rows must be a list")
    if len(rows) > MAX_ROSTER_ROWS:
        raise ValueError(f"連名簿は{MAX_ROSTER_ROWS}件まで出力できます")

    workbook = load_workbook(TEMPLATES[kind])
    sheet = workbook.active
    sheet["C4"] = safe_text(customer_name, 100)
    sheet["E4"] = japanese_date(exam_date)

    for row_number in range(8, 1001):
        for col in range(3, 8):
            sheet.cell(row_number, col).value = None

    for index, item in enumerate(rows, start=8):
        if index > 8:
            copy_row_style(sheet, 8, index)
        sheet.cell(index, 3).value = safe_text(item.get("nameKana") or item.get("name"), 120)
        sheet.cell(index, 4).value = safe_text(item.get("sex"), 20)
        sheet.cell(index, 5).value = safe_age(item.get("age"))
        sheet.cell(index, 6).value = safe_text(item.get("filmNumber"), 40)
        sheet.cell(index, 6).number_format = "@"
        if kind == "chest" and item.get("asbestos"):
            sheet.cell(index, 7).value = "塵肺"

    sheet["F3"] = "=COUNTA($F$8:F1000)"
    if kind == "chest":
        sheet["F2"] = '=COUNTIF($G$8:G1000,"塵肺")'
    if workbook.calculation:
        workbook.calculation.fullCalcOnLoad = True
        workbook.calculation.forceFullCalc = True
        workbook.calculation.calcMode = "auto"

    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return output
