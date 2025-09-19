from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="RAG API (dev)")

# In dev we're using http://app.localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://app.localhost"],
    allow_credentials=True,     # enable cookies if you use them
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatReq(BaseModel):
    message: str

@app.get("/healthz")
def healthz():
    return {"ok": True}

@app.post("/v1/chat")
def chat(req: ChatReq):
    # stub RAG
    return {"reply": f"Echo: {req.message}"}

@app.websocket("/ws/chat")
async def ws_chat(ws: WebSocket):
    await ws.accept()
    await ws.send_text("connected")
    try:
        while True:
            msg = await ws.receive_text()
            await ws.send_text(f"echo: {msg}")
    except Exception:
        await ws.close()
