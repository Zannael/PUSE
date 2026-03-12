# Contributing

Thanks for helping improve this project.

## Workflow

- Fork and create a feature branch.
- Keep commits focused and small.
- Open a PR with a clear summary and testing notes.

## Setup

- Backend: `pip install -r backend/requirements.txt`
- Frontend: `npm install` in `frontend/`

## Validation Before PR

- Backend compile check:
  - `python3 -m py_compile backend/main.py backend/modules/bag.py backend/modules/pc.py backend/modules/party.py backend/modules/money.py`
- Frontend lint:
  - `cd frontend && npm run lint`
- Frontend build:
  - `cd frontend && npm run build`

## Save Files and Privacy

- Do not commit `.sav` files, ROM files, backups, or local artifacts.
- If sharing issue data, sanitize personal information.
