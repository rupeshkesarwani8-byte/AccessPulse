# AccessPulse

**AccessPulse** is an accessibility-reporting web application for identifying and reporting physical barriers in public spaces.

> **Status:** In active development. Implemented features and planned work are listed separately.

## Overview

The current MVP uses Lucknow as a sample city. Users can select a location on an interactive map and submit a report about an accessibility barrier. Reports are stored in a local SQLite database and shown on a dashboard for review.

This is a demonstration project; its data should not be treated as an authoritative city-wide accessibility dataset.

## Current Features

- Interactive map built with Leaflet, React Leaflet, and OpenStreetMap tiles.
- Clicking the map selects latitude/longitude for the report form.
- Submit accessibility reports with a type, description, and location.
- Save reports in SQLite so local data persists across server restarts.
- Dashboard showing saved reports and report statistics.
- Search and filter reports.
- Admin login configured through backend environment variables.
- Login token stored in browser `localStorage` to persist login across page refreshes.
- Admin can verify or reject reports.
- Status changes update dashboard data and counts.
- UI polish including hover, focus, and transition effects.

## Technology Stack

**Frontend:** React, Vite, JavaScript, CSS, Leaflet, React Leaflet, Lucide React  
**Backend:** Python, FastAPI, SQLAlchemy, Pydantic, Uvicorn  
**Database:** SQLite  
**Map tiles:** OpenStreetMap

## Project Structure

Main files currently used during development:

```text
AccessPulse-New/
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── App.css
│       ├── MapView.jsx
│       └── services/
│           └── api.js
└── backend/
    ├── .env                 # Local secrets; never commit
    ├── accesspulse.db       # Local database; preserve this file
    └── app/
        ├── main.py
        ├── models.py
        └── routes/
            ├── reports.py
            └── routing.py
```

This is a working overview, not an exhaustive file listing. Update it if the structure changes.

## How It Works

1. The frontend requests reports and statistics from the FastAPI backend.
2. The user clicks a point on the map.
3. The selected coordinates populate the report form.
4. The frontend submits the report to the API.
5. The backend validates and saves it in SQLite.
6. The dashboard reloads the reports and statistics.
7. An authenticated admin can verify or reject reports.

## Supported Report Types

- `missing_ramp`
- `blocked_path`
- `stairs`
- `broken_sidewalk`
- `inaccessible_crossing`
- `other`

Reports can be pending review, verified, or rejected according to the current workflow. Check the backend model and routes if status values change.

## Local Setup (Windows / PowerShell)

### Prerequisites

- Python
- Node.js and npm
- VS Code or another code editor

### 1. Start the backend

From the project root:

```powershell
cd backend
```

Activate the existing virtual environment:

```powershell
.\.venv\Scripts\Activate.ps1
```

If PowerShell blocks script execution, allow it for the current terminal session only:

```powershell
Set-ExecutionPolicy -Scope Process RemoteSigned
.\.venv\Scripts\Activate.ps1
```

Start FastAPI:

```powershell
uvicorn app.main:app --reload
```

Backend URLs:
- API: `http://127.0.0.1:8000`
- Health: `http://127.0.0.1:8000/api/health`
- Interactive API docs: `http://127.0.0.1:8000/docs`

Keep the backend terminal running.

### 2. Start the frontend

Open a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL Vite prints, usually `http://localhost:5173`.

If PowerShell blocks `npm.ps1`, use:

```powershell
npm.cmd install
npm.cmd run dev
```

## Environment Configuration

Maintain `backend/.env` locally with your own strong credentials and secret key:

```dotenv
ACCESSPULSE_ADMIN_USERNAME=your_admin_username
ACCESSPULSE_ADMIN_PASSWORD=your_strong_admin_password
ACCESSPULSE_SECRET_KEY=replace_with_a_long_random_secret
```

These are placeholders only. Never put real passwords, tokens, or secret keys in this README or a public repository.

## API Overview

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Check backend health |
| `GET` | `/api/reports` | Retrieve reports |
| `POST` | `/api/reports` | Create a report |
| `PATCH` | `/api/reports/{id}/status` | Update report status (admin-protected) |
| `GET` | `/api/stats` | Retrieve dashboard statistics |

For the latest request/response schemas, open `http://127.0.0.1:8000/docs` while the backend is running.

## Data Storage

- Local reports are stored in `backend/accesspulse.db`.
- Restarting VS Code or the development servers should not delete saved reports.
- **Do not delete `backend/accesspulse.db`** if you want to keep current local report data.
- Back up the database before schema changes.
- This local SQLite database is for development/demo use, not shared production storage.

## Security Notes

- Keep `backend/.env` private and make sure it is excluded from version control.
- Never publish admin credentials, secret keys, tokens, or private user data.
- The current `localStorage` token persistence is convenient for the demo but has security trade-offs. Review authentication and session handling before public release.
- Before public exposure, review HTTPS, authorization, validation, CORS, logging, and secret management.
- The current setup should not be considered production-ready.

## Roadmap

### Task 1 — UI Polish
- [x] Improve hover effects, focus states, and transitions.
- [x] Make interactions feel visually responsive.

### Task 2 — Map and Report Interactions
- [ ] Clicking a map marker displays useful report details.
- [ ] Add a report “View Details” action that focuses the map on its coordinates.
- [ ] Use clear marker colors for report statuses.
- [ ] Test interactions with multiple reports.

### Task 3 — Admin Analytics and CSV Export
- [ ] Add useful admin analytics.
- [ ] Export reports to CSV.
- [ ] Test exported fields and filtered-report exports.

### Later Improvements
- [ ] Review responsive behavior on mobile/small screens.
- [ ] Improve keyboard navigation, labels, and accessibility of the interface itself.
- [ ] Add automated tests for important API endpoints and frontend flows.
- [ ] Review database backups and migration strategy.
- [ ] Revisit authentication/session handling before public release.

## Development Notes

- Complete and test roadmap tasks before checking them off.
- When features are added, update **Current Features**, **API Overview**, **Project Structure**, and **Roadmap** as relevant.
- Keep setup instructions aligned with the actual project folders and commands.
- Deployment is intentionally not included in the current roadmap.

---

AccessPulse is an evolving accessibility-reporting demo. This README will be updated as development continues.

### Interactive Accessibility Map and Report Management

AccessPulse provides an interactive map-based interface that helps users explore accessibility barriers reported by the community in the Lucknow demo area. Users can select map markers to view report information, including the report title, barrier type, review status, description, and coordinates. When a report is selected, its location is brought into focus on the map, making it easier to identify where the barrier was reported.

The application also includes a report management interface where users can browse submitted reports, search by keywords, filter reports by review status and barrier type, refresh the report list, and inspect individual report details. Selecting a report from the list or map updates the selected-report information, while a clear-selection option allows users to reset the details panel without deleting the report.

Users can submit new accessibility barrier reports by entering a title, barrier type, description, coordinates, and source. Coordinates can be selected directly from the map or entered manually. Newly submitted reports are stored in the backend database with a pending review status. Authenticated administrators can review pending reports and mark them as verified or rejected. The dashboard updates report statistics and status information after data changes.

These features support community-based accessibility reporting and help users explore reported barriers. Map markers represent submitted reports and should not be interpreted as certified accessible routes or guarantees of current accessibility.