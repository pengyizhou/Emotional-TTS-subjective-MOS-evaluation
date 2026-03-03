import json
import os
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request

BASE_DIR = Path(__file__).resolve().parent.parent
RESULTS_DIR = BASE_DIR / "results"
SESSIONS_DIR = RESULTS_DIR / "sessions"
EVENTS_FILE = RESULTS_DIR / "events.jsonl"

RESULTS_DIR.mkdir(parents=True, exist_ok=True)
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def append_event(event_type: str, payload: dict):
    record = {
        "eventType": event_type,
        "timestamp": now_iso(),
        "payload": payload,
    }
    with EVENTS_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def session_path(evaluator_id: str) -> Path:
    safe = "".join(ch for ch in evaluator_id if ch.isalnum() or ch in ("-", "_"))
    return SESSIONS_DIR / f"{safe}.json"


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "time": now_iso()})


@app.post("/api/state/load")
def load_state():
    body = request.get_json(silent=True) or {}
    evaluator_id = body.get("evaluatorId", "").strip()
    if not evaluator_id:
        return jsonify({"error": "Missing evaluatorId"}), 400

    path = session_path(evaluator_id)
    if not path.exists():
        return jsonify({"found": False, "state": None})

    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return jsonify({"found": True, "state": data})


@app.post("/api/state/save")
def save_state():
    body = request.get_json(silent=True) or {}
    state = body.get("state")
    source = body.get("source", "unknown")

    if not isinstance(state, dict):
        return jsonify({"error": "Missing state object"}), 400

    evaluator_id = (state.get("evaluatorId") or "").strip()
    if not evaluator_id:
        return jsonify({"error": "state.evaluatorId is required"}), 400

    state["serverUpdatedAt"] = now_iso()
    path = session_path(evaluator_id)

    with path.open("w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)

    append_event(
        "state_saved",
        {
            "evaluatorId": evaluator_id,
            "source": source,
            "answeredCount": len((state.get("answers") or {}).keys()),
            "completed": bool(state.get("completed")),
        },
    )

    return jsonify({"ok": True, "savedAt": state["serverUpdatedAt"]})


@app.post("/api/result/finalize")
def finalize():
    body = request.get_json(silent=True) or {}
    state = body.get("state")
    if not isinstance(state, dict):
        return jsonify({"error": "Missing state object"}), 400

    evaluator_id = (state.get("evaluatorId") or "").strip()
    if not evaluator_id:
        return jsonify({"error": "state.evaluatorId is required"}), 400

    state["completed"] = True
    state["finalizedAt"] = now_iso()

    path = session_path(evaluator_id)
    with path.open("w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)

    append_event(
        "finalized",
        {
            "evaluatorId": evaluator_id,
            "answeredCount": len((state.get("answers") or {}).keys()),
        },
    )

    return jsonify({"ok": True, "finalizedAt": state["finalizedAt"]})


if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "5000"))
    app.run(host=host, port=port)
