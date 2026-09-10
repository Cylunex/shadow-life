"""Apply the production migration SQL to the exported Room 5 schema and compare Room 6."""
import json
from pathlib import Path
import sqlite3
import sys

root = Path(__file__).resolve().parents[1]
schemas = root / "apps/android/app/schemas/com.shadow.app.ShadowDatabase"
old = json.loads((schemas / "5.json").read_text())["database"]
new = json.loads((schemas / "6.json").read_text())["database"]
sql = json.loads(Path(sys.argv[1]).read_text())["migration_sql"]

def create(db, schema):
    for entity in schema["entities"]:
        db.execute(entity["createSql"].replace("${TABLE_NAME}", entity["tableName"]))
        for index in entity.get("indices", []):
            db.execute(index["createSql"].replace("${TABLE_NAME}", entity["tableName"]))

with sqlite3.connect(":memory:") as migrated, sqlite3.connect(":memory:") as fresh:
    create(migrated, old)
    create(fresh, new)
    for entity in old["entities"]:
        fields = entity["fields"]
        values = [7 if f["affinity"] == "INTEGER" else "retained_" + f["columnName"] for f in fields]
        migrated.execute(f'INSERT INTO {entity["tableName"]} ({",".join(f["columnName"] for f in fields)}) VALUES ({",".join("?" for _ in fields)})', values)
    before = {e["tableName"]: migrated.execute(f'SELECT * FROM {e["tableName"]}').fetchall() for e in old["entities"]}
    migrated.execute(sql)
    for entity in new["entities"]:
        table = entity["tableName"]
        assert migrated.execute(f"PRAGMA table_info({table})").fetchall() == fresh.execute(f"PRAGMA table_info({table})").fetchall(), table
        assert migrated.execute(f"PRAGMA index_list({table})").fetchall() == fresh.execute(f"PRAGMA index_list({table})").fetchall(), table
    for table, rows in before.items():
        assert migrated.execute(f"SELECT * FROM {table}").fetchall() == rows, table
    migrated.execute("INSERT INTO health_sync_rounds VALUES ('account','subject','round',0,'command',1)")
    migrated.execute("INSERT INTO health_sync_rounds VALUES ('other_account','subject','other_round',2,NULL,3)")
    migrated.execute("INSERT INTO health_sync_rounds VALUES ('account','other_subject','third_round',3,NULL,4)")
    assert migrated.execute("SELECT count(*) FROM health_sync_rounds").fetchone() == (3,)
print("Health Connect: production Room 5→6 migration matches exported schema, preserves queue rows and isolates progress")
