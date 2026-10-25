import os
from pathlib import Path
from flask import Flask, abort, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
app = Flask(__name__)

@app.get("/")
def home():
    return send_from_directory(BASE_DIR, "index.html")

@app.get("/<path:filename>")
def serve_project_file(filename):
    target = (BASE_DIR / filename).resolve()
    if target != BASE_DIR and BASE_DIR not in target.parents:
        abort(404)
    if not target.is_file():
        abort(404)
    return send_from_directory(BASE_DIR, filename)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
