"""
FastAPI Backend for Airline Network Robustness Analysis
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import router
from app.state import load_data_on_startup
import os

app = FastAPI(
    title="Airline Network Robustness API",
    version="1.0.0",
    description="Analyze airline network robustness under various attack scenarios"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

@app.on_event("startup")
async def startup():
    """Load data on startup"""
    load_data_on_startup()

@app.get("/")
async def root():
    return {"message": "Airline Network Robustness API", "status": "ok"}

@app.get("/health")
async def health():
    return {"status": "ok"}

