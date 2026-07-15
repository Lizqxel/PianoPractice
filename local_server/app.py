from __future__ import annotations

import html
import os
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from muscriptor import TranscriptionModel
from muscriptor.server import create_app as create_muscriptor_app

ROOT = Path(__file__).resolve().parents[1]
MAX_UPLOAD_BYTES = 250 * 1024 * 1024
MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024
YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"


def create_local_app(
    model: Any,
    *,
    model_name: str = "medium",
    device_name: str = "cuda",
    youtube_api_key: str = "",
    static_dir: Path | None = None,
) -> FastAPI:
    """Compose MuScriptor's official streaming API with local helper routes."""
    api = create_muscriptor_app(model, web_dir=None)

    @api.get("/status")
    async def status() -> dict[str, object]:
        actual_device = str(getattr(model, "_device", device_name))
        return {
            "status": "ok",
            "model": model_name,
            "device": actual_device,
            "cudaAvailable": actual_device.lower().startswith("cuda"),
            "youtubeSearchConfigured": bool(youtube_api_key),
        }

    @api.get("/youtube/search")
    async def youtube_search(q: str) -> dict[str, list[dict[str, str]]]:
        query = q.strip()
        if not youtube_api_key:
            raise HTTPException(
                status_code=503,
                detail="YouTubeタイトル検索には.envのYOUTUBE_API_KEY設定が必要です。",
            )
        if not query:
            raise HTTPException(status_code=400, detail="検索する曲名を入力してください。")
        params = {
            "part": "snippet",
            "q": query,
            "type": "video",
            "videoEmbeddable": "true",
            "maxResults": 8,
            "safeSearch": "moderate",
            "key": youtube_api_key,
        }
        try:
            async with httpx.AsyncClient(timeout=12) as client:
                response = await client.get(YOUTUBE_SEARCH_URL, params=params)
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPStatusError as error:
            raise HTTPException(
                status_code=502,
                detail="YouTube検索に失敗しました。APIキーと利用上限を確認してください。",
            ) from error
        except (httpx.HTTPError, ValueError) as error:
            raise HTTPException(
                status_code=502,
                detail="YouTube検索サービスへ接続できませんでした。",
            ) from error

        items: list[dict[str, str]] = []
        for item in payload.get("items", []):
            video_id = item.get("id", {}).get("videoId")
            snippet = item.get("snippet", {})
            thumbnails = snippet.get("thumbnails", {})
            thumbnail = thumbnails.get("medium") or thumbnails.get("default") or {}
            if video_id:
                items.append(
                    {
                        "videoId": video_id,
                        "title": html.unescape(snippet.get("title", "YouTube動画")),
                        "channelTitle": html.unescape(snippet.get("channelTitle", "")),
                        "thumbnailUrl": thumbnail.get("url", ""),
                    }
                )
        return {"items": items}

    app = FastAPI(title="PianoPractice Local", docs_url="/api/docs")

    @app.middleware("http")
    async def reject_oversized_upload(request: Request, call_next):
        if request.url.path == "/api/transcribe":
            content_length = request.headers.get("content-length")
            if content_length and content_length.isdigit() and int(content_length) > MAX_REQUEST_BYTES:
                return JSONResponse(
                    status_code=413,
                    content={"detail": "音声ファイルが大きすぎます。250MB以下のファイルを選んでください。"},
                )
        return await call_next(request)

    app.mount("/api", api, name="api")
    web_dir = static_dir or ROOT / "dist"
    if web_dir.is_dir():
        app.mount("/", StaticFiles(directory=web_dir, html=True), name="web")

    return app


def create_default_app() -> FastAPI:
    """Uvicorn factory. Model selection is fixed for the lifetime of the process."""
    load_dotenv(ROOT / ".env")
    model_name = os.getenv("MUSCRIPTOR_MODEL", "medium").strip() or "medium"
    device_name = os.getenv("MUSCRIPTOR_DEVICE", "cuda").strip() or "cuda"
    youtube_api_key = os.getenv("YOUTUBE_API_KEY", "").strip()
    model = TranscriptionModel.load_model(weights_path=model_name, device=device_name)
    return create_local_app(
        model,
        model_name=model_name,
        device_name=device_name,
        youtube_api_key=youtube_api_key,
    )
