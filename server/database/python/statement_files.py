"""Lossless file-to-text adapter. Business parsing and writes belong to Life.

Reads one private JSON request from stdin; never accepts passwords on argv.
Archives are read in memory, never extracted. Optional AES ZIP support uses pyzipper.
"""
import csv
import base64
import io
import json
import re
import sys
import zipfile
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET

MAX_BYTES = 20 * 1024 * 1024
MAX_MEMBERS = 2000
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def archive(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    infos = z.infolist()
    if len(infos) > MAX_MEMBERS or sum(i.file_size for i in infos) > MAX_BYTES:
        raise ValueError("Archive exceeds expanded size or member limit")
    for i in infos:
        path = PurePosixPath(i.filename)
        if path.is_absolute() or ".." in path.parts or "\\" in i.filename:
            raise ValueError("Unsafe archive member")
    return z


def xml(data):
    text = data.decode("utf-8-sig")
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise ValueError("XML declarations are not supported")
    return ET.fromstring(text)


# The language-dependent formats in this set describe calendar dates in all
# East Asian variants listed by the Open XML numbering format reference.
BUILTIN_CALENDAR_FORMATS = {14, 15, 16, 17, 27, 28, 29, 30, 31, 36, 50, 51, 54, 57, 58}


def xlsx_date_styles(z):
    if "xl/styles.xml" not in z.namelist():
        return {}
    root = xml(z.read("xl/styles.xml"))
    formats = {fmt.get("numFmtId"): fmt.get("formatCode", "") for fmt in root.findall("s:numFmts/s:numFmt", NS)}
    result = {}
    for index, xf in enumerate(root.findall("s:cellXfs/s:xf", NS)):
        fmt_id = xf.get("numFmtId", "0")
        if fmt_id in formats:
            # Quoted text, escaped characters, color and locale directives are not date tokens.
            code = re.sub(r'"[^"]*"|\\.|_.|\*.|\[[^\]]*\]', "", formats[fmt_id]).split(";")[0].lower()
            if re.search(r"[yd]", code):
                result[str(index)] = bool(re.search(r"[hs]", code))
        elif fmt_id == "22" or int(fmt_id) in BUILTIN_CALENDAR_FORMATS:
            result[str(index)] = fmt_id == "22"
    return result


def xlsx_date_value(value, date1904, shows_clock):
    try:
        serial = Decimal(value)
        if not serial.is_finite() or not 0 <= serial < 3_000_000:
            return value
        days = int(serial)
        if not date1904 and days == 60:
            # Excel can represent the fictitious Gregorian 1900-02-29.
            return value
        fraction = serial - days
        seconds = int((fraction * 86_400).to_integral_value(rounding=ROUND_HALF_UP))
        epoch = datetime(1904, 1, 1) if date1904 else datetime(1899, 12, 31)
        if not date1904 and days > 60:
            days -= 1
        result = epoch + timedelta(days=days, seconds=seconds)
        return result.isoformat(sep=" ", timespec="seconds") if shows_clock or fraction else result.date().isoformat()
    except (InvalidOperation, OverflowError):
        return value


def xlsx_rows(data):
    z = archive(data)
    members = set(z.namelist())
    date_styles = xlsx_date_styles(z)
    workbook = xml(z.read("xl/workbook.xml")) if "xl/workbook.xml" in members else None
    properties = workbook.find("s:workbookPr", NS) if workbook is not None else None
    date1904 = properties is not None and properties.get("date1904") in ("1", "true")
    strings = []
    if "xl/sharedStrings.xml" in z.namelist():
        strings = ["".join(si.itertext()) for si in xml(z.read("xl/sharedStrings.xml")).findall("s:si", NS)]
    sheets = sorted(n for n in z.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n))
    populated = []
    for name in sheets:
        rows = []
        for row in xml(z.read(name)).findall("s:sheetData/s:row", NS):
            cells = {}
            for cell in row.findall("s:c", NS):
                ref = cell.get("r", "")
                match = re.fullmatch(r"([A-Z]+)[0-9]+", ref)
                if not match or cell.find("s:f", NS) is not None:
                    raise ValueError("Unsupported cell reference or formula in statement")
                col = 0
                for char in match[1]:
                    col = col * 26 + ord(char) - 64
                if col > 200:
                    raise ValueError("Too many worksheet columns")
                kind = cell.get("t")
                value = cell.findtext("s:v", "", NS)
                if kind == "s":
                    value = strings[int(value)]
                elif kind == "inlineStr":
                    value = "".join(cell.find("s:is", NS).itertext())
                elif kind in (None, "n"):
                    style = cell.get("s", "0")
                    if value and style in date_styles:
                        value = xlsx_date_value(value, date1904, date_styles[style])
                elif kind not in ("str", "d"):
                    raise ValueError("Unsupported worksheet value")
                cells[col - 1] = value
            if cells:
                rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
        if rows:
            populated.append(rows)
    if len(populated) != 1:
        raise ValueError("Select a statement with exactly one populated worksheet")
    rows = populated[0]
    width = max(map(len, rows))
    return [row + [""] * (width - len(row)) for row in rows]


def read_rows(data, name):
    if name.lower().endswith(".xlsx"):
        return xlsx_rows(data)
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError("Unsupported text encoding")
    if "\x00" in text:
        raise ValueError("Unsupported binary file")
    if name.lower().endswith(".json"):
        obj = json.loads(text, parse_int=str, parse_float=str)
        rows = obj if isinstance(obj, list) else obj.get("transactions")
        if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
            raise ValueError("JSON statement must contain objects")
        return rows
    return list(csv.reader(io.StringIO(text), strict=True))


def convert(data, name, password=None, member=None):
    if len(data) > MAX_BYTES:
        raise ValueError("File exceeds size limit")
    if name.lower().endswith(".zip"):
        z = archive(data)
        names = [n for n in z.namelist() if not n.endswith("/") and n.lower().endswith((".csv", ".xlsx", ".json"))]
        if member is None and len(names) != 1:
            return {"members": names, "selectionRequired": True}
        member = member or names[0]
        if member not in names:
            raise ValueError("Unknown statement member")
        pwd = password.encode("utf-8") if password else None
        if z.getinfo(member).compress_type == 99:
            import pyzipper
            z = pyzipper.AESZipFile(io.BytesIO(data))
        data = z.read(member, pwd=pwd)
        if len(data) > MAX_BYTES:
            raise ValueError("Expanded file exceeds limit")
        name = member
    rows = read_rows(data, name)
    if not rows or isinstance(rows[0], dict):
        return {"name": name, "rows": rows}
    # Find the actual export header, leaving platform business rules to Life.
    markers = {"交易时间", "交易日期", "交易创建时间", "交易成功时间", "订单提交时间", "date", "occurred_on", "occurred_at", "transaction_date", "transaction_time", "transaction_id"}
    start = next((i for i, row in enumerate(rows) if len(row) >= 3 and any(c.strip() in markers for c in row)), None)
    if start is None:
        raise ValueError("No supported statement header")
    headers = [c.strip() for c in rows[start]]
    while headers and not headers[-1]:
        headers.pop()
    if any(not h for h in headers) or len(set(headers)) != len(headers):
        raise ValueError("Empty or duplicate statement header")
    result = []
    footer = False
    for row in rows[start + 1:]:
        if not any(c.strip() for c in row):
            continue
        first = next(c.strip() for c in row if c.strip())
        if re.match(r"^(?:[-=＊*]{3,}|共\s*\d+\s*笔|合计|统计|收入\s*[:：]|支出\s*[:：]|导出时间|账单导出时间|注[:：]|说明[:：])", first) and sum(bool(c.strip()) for c in row) <= 2:
            footer = True
            continue
        if footer:
            raise ValueError("Unexpected row after export footer")
        if len(row) < len(headers) or any(c.strip() for c in row[len(headers):]):
            raise ValueError("Statement column count mismatch")
        row = row[:len(headers)] + [""] * max(0, len(headers) - len(row))
        result.append(dict(zip(headers, (c.strip() for c in row))))
    return {"name": name, "rows": result}


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.read(30 * 1024 * 1024))
        data = base64.b64decode(request["data"], validate=True)
        result = convert(data, request["name"], request.get("password"), request.get("member"))
        if len(result.get("rows", [])) > 50000:
            raise ValueError("Too many statement rows")
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        print(json.dumps({"isError": True, "code": "invalid_file_or_password"}))
        sys.exit(1)
