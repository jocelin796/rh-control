from __future__ import annotations

import json
import os
import sqlite3
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
LOCAL_DB_DIR = ROOT / "database"
SCHEMA_PATH = LOCAL_DB_DIR / "schema.sql"
RENDER_DB_PATH = Path("/var/data/rh_control.sqlite")
DB_PATH = Path(os.environ.get("RH_DATABASE_PATH") or (RENDER_DB_PATH if os.environ.get("RENDER") else LOCAL_DB_DIR / "rh_control.sqlite"))
DB_DIR = DB_PATH.parent
HOST = os.environ.get("HOST") or ("0.0.0.0" if os.environ.get("PORT") else "127.0.0.1")
PORT = int(os.environ.get("PORT", "8750"))


def connect() -> sqlite3.Connection:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        schema = SCHEMA_PATH.read_text(encoding="utf-8")
        conn.executescript(schema)
        conn.execute(
            "INSERT OR REPLACE INTO app_meta(key, value) VALUES (?, ?)",
            ("schema_version", "1"),
        )


def rows(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    return list(conn.execute(sql, params).fetchall())


def one(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> sqlite3.Row | None:
    return conn.execute(sql, params).fetchone()


def json_value(value, fallback):
    if value is None:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def get_state() -> dict:
    with connect() as conn:
        settings_rows = rows(conn, "SELECT key, value FROM settings")
        settings = {item["key"]: json_value(item["value"], item["value"]) for item in settings_rows}

        employees = []
        for emp in rows(conn, "SELECT * FROM employees ORDER BY sort_order, last_name, first_name"):
            balance = one(conn, "SELECT * FROM leave_balances WHERE employee_id = ?", (emp["id"],))
            contracts = []
            for contract in rows(conn, "SELECT * FROM contracts WHERE employee_id = ? ORDER BY sort_order", (emp["id"],)):
                history = [
                    item["entry"]
                    for item in rows(conn, "SELECT entry FROM contract_history WHERE contract_id = ? ORDER BY sort_order, id", (contract["id"],))
                ]
                contracts.append(
                    {
                        "id": contract["id"],
                        "type": contract["type"],
                        "start": contract["start_date"] or "",
                        "end": contract["end_date"] or "",
                        "duration": contract["duration"] or "",
                        "fonction": contract["fonction"] or "",
                        "service": contract["service"] or "",
                        "salary": contract["salary"] or 0,
                        "renewalDate": contract["renewal_date"] or "",
                        "renewalCount": contract["renewal_count"] or 0,
                        "document": contract["document"] or "",
                        "status": contract["status"] or "",
                        "history": history,
                    }
                )

            employees.append(
                {
                    "id": emp["id"],
                    "matricule": emp["matricule"],
                    "firstName": emp["first_name"],
                    "lastName": emp["last_name"],
                    "service": emp["service"],
                    "direction": emp["direction_name"] or "",
                    "agency": emp["agency"] or "",
                    "fonction": emp["fonction"] or "",
                    "status": emp["status"] or "Actif",
                    "leaveBalance": {
                        "initial": balance["initial_days"] if balance else 0,
                        "acquired": balance["acquired_days"] if balance else 0,
                        "taken": balance["taken_days"] if balance else 0,
                        "planned": balance["planned_days"] if balance else 0,
                        "available": balance["available_days"] if balance else 0,
                    },
                    "contracts": contracts,
                }
            )

        leave_requests = []
        for leave in rows(conn, "SELECT * FROM leave_requests ORDER BY sort_order, created_at DESC"):
            observations = [
                item["entry"]
                for item in rows(conn, "SELECT entry FROM leave_observations WHERE leave_id = ? ORDER BY sort_order, id", (leave["id"],))
            ]
            history = [
                item["entry"]
                for item in rows(conn, "SELECT entry FROM leave_history WHERE leave_id = ? ORDER BY sort_order, id", (leave["id"],))
            ]
            leave_requests.append(
                {
                    "id": leave["id"],
                    "employeeId": leave["employee_id"],
                    "type": leave["type"],
                    "start": leave["start_date"] or "",
                    "end": leave["end_date"] or "",
                    "returnDate": leave["return_date"] or "",
                    "days": leave["days"] or 0,
                    "reason": leave["reason"] or "",
                    "comment": leave["comment"] or "",
                    "attachment": leave["attachment"] or "",
                    "status": leave["status"] or "",
                    "observations": observations,
                    "createdAt": leave["created_at"] or "",
                    "history": history,
                }
            )

        documents = [
            {
                "id": doc["id"],
                "employeeId": doc["employee_id"] or "",
                "leaveId": doc["leave_id"] or "",
                "title": doc["title"],
                "status": doc["status"] or "",
                "createdAt": doc["created_at"] or "",
                "content": doc["content"] or "",
            }
            for doc in rows(conn, "SELECT * FROM documents ORDER BY sort_order, created_at DESC")
        ]

        audit_log = [
            {
                "date": item["date"],
                "actor": item["actor"],
                "action": item["action"],
            }
            for item in rows(conn, "SELECT * FROM audit_log ORDER BY sort_order, id")
        ]

        default_settings = {
            "contractAlertDays": [90, 60, 30, 15, 7],
            "returnAlertDays": [3, 1, 0],
            "workingDays": [1, 2, 3, 4, 5],
            "holidays": ["2026-01-01", "2026-04-06", "2026-05-01", "2026-08-07", "2026-12-25"],
            "allowExceptionalLeave": True,
            "ticketEnabled": True,
        }
        default_settings.update(settings)

        role_row = one(conn, "SELECT value FROM app_meta WHERE key = ?", ("current_role",))

        return {
            "currentRole": role_row["value"] if role_row else "Admin RH",
            "settings": default_settings,
            "employees": employees,
            "leaveRequests": leave_requests,
            "documents": documents,
            "auditLog": audit_log,
        }


def save_state(data: dict) -> None:
    with connect() as conn:
        conn.execute("BEGIN")
        for table in [
            "contract_history",
            "leave_observations",
            "leave_history",
            "documents",
            "leave_requests",
            "contracts",
            "leave_balances",
            "employees",
            "settings",
            "audit_log",
        ]:
            conn.execute(f"DELETE FROM {table}")

        conn.execute(
            "INSERT OR REPLACE INTO app_meta(key, value) VALUES (?, ?)",
            ("current_role", data.get("currentRole", "Admin RH")),
        )

        for key, value in data.get("settings", {}).items():
            conn.execute(
                "INSERT INTO settings(key, value) VALUES (?, ?)",
                (key, json.dumps(value, ensure_ascii=False)),
            )

        for emp_index, employee in enumerate(data.get("employees", [])):
            conn.execute(
                """
                INSERT INTO employees(
                  id, matricule, first_name, last_name, service, direction_name,
                  agency, fonction, status, sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    employee.get("id"),
                    employee.get("matricule", ""),
                    employee.get("firstName", ""),
                    employee.get("lastName", ""),
                    employee.get("service", ""),
                    employee.get("direction", ""),
                    employee.get("agency", ""),
                    employee.get("fonction", ""),
                    employee.get("status", "Actif"),
                    emp_index,
                ),
            )

            balance = employee.get("leaveBalance", {})
            conn.execute(
                """
                INSERT INTO leave_balances(
                  employee_id, initial_days, acquired_days, taken_days, planned_days, available_days
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    employee.get("id"),
                    balance.get("initial", 0),
                    balance.get("acquired", 0),
                    balance.get("taken", 0),
                    balance.get("planned", 0),
                    balance.get("available", 0),
                ),
            )

            for contract_index, contract in enumerate(employee.get("contracts", [])):
                conn.execute(
                    """
                    INSERT INTO contracts(
                      id, employee_id, type, start_date, end_date, duration, fonction,
                      service, salary, renewal_date, renewal_count, document, status, sort_order
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        contract.get("id"),
                        employee.get("id"),
                        contract.get("type", ""),
                        contract.get("start", ""),
                        contract.get("end", ""),
                        contract.get("duration", ""),
                        contract.get("fonction", ""),
                        contract.get("service", ""),
                        contract.get("salary", 0),
                        contract.get("renewalDate", ""),
                        contract.get("renewalCount", 0),
                        contract.get("document", ""),
                        contract.get("status", ""),
                        contract_index,
                    ),
                )
                for hist_index, entry in enumerate(contract.get("history", [])):
                    conn.execute(
                        "INSERT INTO contract_history(contract_id, entry, sort_order) VALUES (?, ?, ?)",
                        (contract.get("id"), entry, hist_index),
                    )

        for leave_index, leave in enumerate(data.get("leaveRequests", [])):
            conn.execute(
                """
                INSERT INTO leave_requests(
                  id, employee_id, type, start_date, end_date, return_date,
                  days, reason, comment, attachment, status, created_at, sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    leave.get("id"),
                    leave.get("employeeId"),
                    leave.get("type", ""),
                    leave.get("start", ""),
                    leave.get("end", ""),
                    leave.get("returnDate", ""),
                    leave.get("days", 0),
                    leave.get("reason", ""),
                    leave.get("comment", ""),
                    leave.get("attachment", ""),
                    leave.get("status", ""),
                    leave.get("createdAt", ""),
                    leave_index,
                ),
            )
            for obs_index, entry in enumerate(leave.get("observations", [])):
                conn.execute(
                    "INSERT INTO leave_observations(leave_id, entry, sort_order) VALUES (?, ?, ?)",
                    (leave.get("id"), entry, obs_index),
                )
            for hist_index, entry in enumerate(leave.get("history", [])):
                conn.execute(
                    "INSERT INTO leave_history(leave_id, entry, sort_order) VALUES (?, ?, ?)",
                    (leave.get("id"), entry, hist_index),
                )

        for doc_index, doc in enumerate(data.get("documents", [])):
            conn.execute(
                """
                INSERT INTO documents(
                  id, employee_id, leave_id, title, status, created_at, content, sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    doc.get("id"),
                    doc.get("employeeId") or None,
                    doc.get("leaveId") or None,
                    doc.get("title", ""),
                    doc.get("status", ""),
                    doc.get("createdAt", ""),
                    doc.get("content", ""),
                    doc_index,
                ),
            )

        for audit_index, item in enumerate(data.get("auditLog", [])):
            conn.execute(
                "INSERT INTO audit_log(date, actor, action, sort_order) VALUES (?, ?, ?, ?)",
                (
                    item.get("date", ""),
                    item.get("actor", ""),
                    item.get("action", ""),
                    audit_index,
                ),
            )

        conn.commit()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json({"ok": True, "database": str(DB_PATH), "mode": "sqlite"})
            return
        if path == "/api/bootstrap":
            self.send_json({"ok": True, "database": str(DB_PATH), "data": get_state()})
            return
        return super().do_GET()

    def do_PUT(self):
        path = urlparse(self.path).path
        if path == "/api/state":
            try:
                payload = self.read_json()
                save_state(payload.get("data", payload))
                self.send_json({"ok": True, "database": str(DB_PATH)})
            except Exception as exc:
                self.send_json({"ok": False, "error": str(exc)}, status=500)
            return
        self.send_json({"ok": False, "error": "Route inconnue"}, status=404)


def main() -> None:
    init_db()
    display_host = "127.0.0.1" if HOST == "0.0.0.0" else HOST
    url = f"http://{display_host}:{PORT}/"
    print("Application RH démarrée")
    print(f"URL        : {url}")
    print(f"Base SQLite: {DB_PATH}")
    if not os.environ.get("PORT"):
        print("Laisse cette fenêtre ouverte pendant l'utilisation.")
    if "--no-browser" not in sys.argv and not os.environ.get("PORT"):
        try:
            webbrowser.open(url)
        except Exception:
            pass
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
