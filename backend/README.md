# FastAPI Firebase Auth Backend (Minimal)

This backend pairs with the React SPA (cookie-based Firebase auth).

## Endpoints
- `POST /auth/session`  
  Body: `id_token=<firebase-id-token>`  
  Exchanges Firebase ID token for a session cookie, sets `fb_session` HttpOnly cookie.

- `POST /auth/logout`  
  Clears the session cookie (and optionally revokes refresh tokens).

- `GET /session`  
  Returns `{ user }` if session cookie is valid.

## Setup
1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Add Firebase service account JSON key (download from Firebase Console) and set env vars:
   ```env
   FIREBASE_PROJECT_ID=your-project-id
   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json
   ```
3. Run server:
   ```bash
   uvicorn main:app --reload --port 3000
   ```
4. React frontend will talk to this at `http://localhost:3000`.

## Notes
- This is minimal. Add CORS origins, rate limiting, and audit logging before production.
