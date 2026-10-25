import io
import csv
import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from statement_files import convert, xml, MAX_BYTES


class StatementFilesTest(unittest.TestCase):
    def test_gbk_csv_preserves_long_ids_and_decimal_text(self):
        rows = convert('导出说明\n交易时间,金额,交易订单号\n2026-10-01,12.30,123456789012345678901\n'.encode('gb18030'), 'bill.csv')['rows']
        self.assertEqual(rows[0]['交易订单号'], '123456789012345678901')
        self.assertEqual(rows[0]['金额'], '12.30')

    def test_zip_no_extraction_and_selection(self):
        b = io.BytesIO()
        with zipfile.ZipFile(b, 'w') as z:
            z.writestr('bill.csv', 'date,amount,type\n2026-10-01,2.50,expense')
            z.writestr('other.csv', 'date,amount,type\n2026-10-02,3.50,expense')
        self.assertTrue(convert(b.getvalue(), 'bill.zip')['selectionRequired'])
        self.assertEqual(convert(b.getvalue(), 'bill.zip', member='other.csv')['rows'][0]['amount'], '3.50')

    def test_path_traversal_and_expansion_limits(self):
        for name, data in [('../escape.csv', 'date,amount,type'), ('bill.csv', 'x' * (MAX_BYTES + 1))]:
            b = io.BytesIO()
            with zipfile.ZipFile(b, 'w', compression=zipfile.ZIP_DEFLATED) as z:
                z.writestr(name, data)
            with self.assertRaises(ValueError):
                convert(b.getvalue(), 'bill.zip')

    def test_xlsx_reads_original_strings_and_rejects_formulas(self):
        for formula in ('', '<f>1+1</f>'):
            b = io.BytesIO()
            with zipfile.ZipFile(b, 'w') as z:
                z.writestr('xl/worksheets/sheet1.xml', f'''<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
                <row><c r="A1" t="inlineStr"><is><t>订单提交时间</t></is></c><c r="B1" t="inlineStr"><is><t>订单号</t></is></c><c r="C1" t="inlineStr"><is><t>实付金额</t></is></c></row>
                <row><c r="A2" t="inlineStr"><is><t>2026-10-01</t></is></c><c r="B2" t="inlineStr"><is><t>12345678901234567890</t></is></c><c r="C2">{formula}<v>12.30</v></c></row>
                </sheetData></worksheet>''')
            if formula:
                with self.assertRaises(ValueError):
                    convert(b.getvalue(), 'bill.xlsx')
            else:
                row = convert(b.getvalue(), 'bill.xlsx')['rows'][0]
                self.assertEqual(row['订单号'], '12345678901234567890')
                self.assertEqual(row['实付金额'], '12.30')

    @unittest.skipUnless(importlib.util.find_spec('pyzipper'), 'AES ZIP dependency is optional')
    def test_aes_zip_password_and_original_csv(self):
        import pyzipper
        data = io.BytesIO()
        with pyzipper.AESZipFile(data, 'w', encryption=pyzipper.WZ_AES) as z:
            z.setpassword(b'synthetic-pass')
            z.writestr('bill.csv', 'date,amount,type\n2026-10-01,12.30,expense')
        self.assertEqual(convert(data.getvalue(), 'bill.zip', 'synthetic-pass')['rows'][0]['amount'], '12.30')
        with self.assertRaises(RuntimeError):
            convert(data.getvalue(), 'bill.zip', 'wrong-pass')

    def test_malformed_csv_and_xml_are_rejected(self):
        with self.assertRaises(ValueError):
            xml(b'<!DOCTYPE x><x/>')
        for content in ['date,amount,type\n2026-10-01,2.50', 'date,amount,type\n2026-10-01,"broken']:
            with self.assertRaises((ValueError, csv.Error)):
                convert(content.encode(), 'bill.csv')


if __name__ == '__main__':
    unittest.main()
