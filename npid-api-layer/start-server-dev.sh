#!/bin/bash
# Dev auto-reload script for NPID FastAPI server
# Activates venv and starts uvicorn with --reload

cd "$(dirname "$0")"
source venv/bin/activate
exec uvicorn main:app --host 127.0.0.1 --port 8000 --reload
