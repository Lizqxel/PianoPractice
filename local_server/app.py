from __future__ import annotations

import html
import json
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

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
UFRET_ORIGIN = "https://www.ufret.jp"
UFRET_USER_AGENT = "ChordSprint/1.0"


def parse_ufret_song_page(source: str, source_url: str) -> dict[str, object]:
    data_match = re.search(r"var\s+ufret_chord_datas\s*=\s*(\[.*?\]);", source, re.DOTALL)
    if not data_match:
        raise ValueError("コード配列が見つかりません。")
    rows = json.loads(data_match.group(1))
    chart_rows: list[str] = []
    chord_count = 0
    for row in rows:
        chords = [normalize_ufret_chord(value) for value in re.findall(r"\[([^\]]+)\]", str(row))]
        chords = [value for value in chords if value]
        if chords:
            chart_rows.append(" ".join(chords))
            chord_count += len(chords)
    if not chart_rows:
        raise ValueError("コード記号が見つかりません。")

    title_match = re.search(r"<title>\s*(.*?)\s*/\s*(.*?)\s+ギターコード", source, re.DOTALL | re.IGNORECASE)
    title = clean_html_text(title_match.group(1)) if title_match else "U-FRETコード譜"
    artist = clean_html_text(title_match.group(2)) if title_match else "アーティスト不明"
    bpm_match = re.search(r"const\s+defaultBpm\s*=\s*[\"'](\d+(?:\.\d+)?)[\"']", source)
    youtube_match = re.search(r"var\s+ytID\s*=\s*['\"]([A-Za-z0-9_-]{11})['\"]", source)
    version = "動画プラス" if "動画プラス" in title else "初心者ver" if "初心者" in title else "通常ver"
    result: dict[str, object] = {
        "title": title.replace("(初心者向け簡単コード ver.)", "").replace("(動画プラス)", "").strip(),
        "artist": artist,
        "url": source_url,
        "version": version,
        "chartText": " | ".join(chart_rows),
        "bpm": round(float(bpm_match.group(1))) if bpm_match else 100,
        "chordCount": chord_count,
    }
    if youtube_match:
        result["youtubeVideoId"] = youtube_match.group(1)
    return result


def find_ufret_video_plus_url(source: str) -> str | None:
    for href, label in re.findall(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', source, re.DOTALL | re.IGNORECASE):
        if "動画プラス" not in clean_html_text(label):
            continue
        match = re.search(r"(?:^|[?&])data=(\d+)(?:&|$)", html.unescape(href))
        if match:
            return f"{UFRET_ORIGIN}/song.php?data={match.group(1)}"
    return None


def parse_ufret_video_plus_page(source: str, source_url: str) -> dict[str, object]:
    body_match = re.search(r'<div\s+id=["\']blyodnijb["\'][^>]*>(.*?)</div>', source, re.DOTALL | re.IGNORECASE)
    chord_change_match = re.search(r"var\s+chord_change\s*=\s*['\"]([09]+)['\"]", source)
    bpm_match = re.search(r"var\s+song_bpm\s*=\s*Number\(['\"](\d+(?:\.\d+)?)['\"]\)", source)
    start_match = re.search(r"var\s+start_chord\s*=\s*Number\(['\"](\d+(?:\.\d+)?)['\"]\)\s*/\s*1000", source)
    youtube_match = re.search(r"var\s+ytID\s*=\s*['\"]([A-Za-z0-9_-]{11})['\"]", source)
    tempo_match = re.search(r"var\s+tempo_change\s*=\s*JSON\.parse\((['\"])(.*?)\1\)", source)
    if not body_match or not chord_change_match or not bpm_match or not start_match or not youtube_match:
        raise ValueError("動画プラスの同期情報が見つかりません。")

    chart_rows: list[str] = []
    chord_count = 0
    for row in re.findall(r'<p\b[^>]*class=["\'][^"\']*atfolhyds[^"\']*["\'][^>]*>(.*?)</p>', body_match.group(1), re.DOTALL | re.IGNORECASE):
        chords = [normalize_ufret_chord(clean_html_text(value)) for value in re.findall(r"<rt[^>]*>(.*?)</rt>", row, re.DOTALL | re.IGNORECASE)]
        chords = [value for value in chords if value]
        if chords:
            chart_rows.append(" ".join(chords))
            chord_count += len(chords)
    if not chart_rows:
        raise ValueError("動画プラスのコード記号が見つかりません。")

    chord_change = chord_change_match.group(1)
    if chord_change.count("0") != chord_count:
        raise ValueError("動画プラスのコード数と同期位置が一致しません。")

    tempo_changes: list[str] = []
    if tempo_match:
        try:
            decoded = json.loads(bytes(tempo_match.group(2), "utf-8").decode("unicode_escape"))
            if isinstance(decoded, list):
                tempo_changes = [str(value) for value in decoded if str(value).strip()]
        except (json.JSONDecodeError, UnicodeDecodeError):
            tempo_changes = []

    title_match = re.search(r"<title>\s*(.*?)\s*/\s*(.*?)\s+ギターコード", source, re.DOTALL | re.IGNORECASE)
    title = clean_html_text(title_match.group(1)) if title_match else "U-FRETコード譜"
    artist = clean_html_text(title_match.group(2)) if title_match else "アーティスト不明"
    youtube_video_id = youtube_match.group(1)
    bpm = float(bpm_match.group(1))
    return {
        "title": title.replace("(動画プラス)", "").replace("動画プラス", "").strip(),
        "artist": artist,
        "url": source_url,
        "version": "動画プラス",
        "chartText": " | ".join(chart_rows),
        "bpm": round(bpm),
        "chordCount": chord_count,
        "youtubeVideoId": youtube_video_id,
        "timing": {
            "sourceUrl": source_url,
            "youtubeVideoId": youtube_video_id,
            "bpm": bpm,
            "startChord": float(start_match.group(1)) / 1000,
            "chordChange": chord_change,
            "tempoChanges": tempo_changes,
        },
    }


def same_ufret_chord_sequence(left: str, right: str) -> bool:
    split = lambda value: [token for token in re.split(r"\s+|\|", value) if token]
    return split(left) == split(right)


def parse_ufret_search_page(source: str) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    pattern = re.compile(
        r'<li class="c-list__item\s+([^"\s]+)[^\"]*">.*?'
        r'<a href="/song\.php\?data=(\d+)".*?'
        r'<p class="c-list__title">(.*?)</p>.*?'
        r'<p class="c-list__artist">(.*?)</p>',
        re.DOTALL | re.IGNORECASE,
    )
    versions = {"beginner-chord": "初心者ver", "movie-chord": "動画プラス", "normal-chord": "通常ver"}
    for score_class, song_id, raw_title, raw_artist in pattern.findall(source):
        items.append({
            "title": clean_html_text(raw_title).replace("初心者ver", "").replace("動画プラス", "").strip(),
            "artist": clean_html_text(raw_artist),
            "url": f"{UFRET_ORIGIN}/song.php?data={song_id}",
            "version": versions.get(score_class, "コード譜"),
        })
    return items


def normalize_ufret_chord(value: str) -> str:
    return value.strip().replace("♭", "b").replace("♯", "#")


def clean_html_text(value: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", value)).split())


def normalize_ufret_song_url(value: str) -> str:
    parsed = urlparse(value.strip())
    query_match = re.search(r"(?:^|&)data=(\d+)(?:&|$)", parsed.query)
    if parsed.scheme != "https" or parsed.hostname not in {"ufret.jp", "www.ufret.jp"} or parsed.path != "/song.php" or not query_match:
        raise ValueError("U-FRETの曲ページURLを指定してください。")
    return f"{UFRET_ORIGIN}/song.php?data={query_match.group(1)}"


async def fetch_ufret_text(url: str) -> str:
    async with httpx.AsyncClient(
        timeout=15,
        follow_redirects=True,
        headers={"User-Agent": UFRET_USER_AGENT, "Accept": "text/html,text/plain"},
    ) as client:
        robots_response = await client.get(f"{UFRET_ORIGIN}/robots.txt")
        robots_response.raise_for_status()
        robots = RobotFileParser()
        robots.set_url(f"{UFRET_ORIGIN}/robots.txt")
        robots.parse(robots_response.text.splitlines())
        if not robots.can_fetch(UFRET_USER_AGENT, url):
            raise PermissionError("robots.txtで取得が許可されていません。")
        response = await client.get(url)
        response.raise_for_status()
        response.encoding = "utf-8"
        final_url = urlparse(str(response.url))
        if final_url.hostname not in {"ufret.jp", "www.ufret.jp"}:
            raise ValueError("U-FRET以外へリダイレクトされました。")
        return response.text


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

    @api.get("/ufret/search")
    async def ufret_search(q: str) -> dict[str, list[dict[str, str]]]:
        query = q.strip()
        if not query:
            raise HTTPException(status_code=400, detail="検索する曲名を入力してください。")
        if len(query) > 120:
            raise HTTPException(status_code=400, detail="検索語が長すぎます。")
        url = f"{UFRET_ORIGIN}/search.php"
        try:
            async with httpx.AsyncClient(
                timeout=15,
                follow_redirects=True,
                headers={"User-Agent": UFRET_USER_AGENT, "Accept": "text/html"},
            ) as client:
                robots_response = await client.get(f"{UFRET_ORIGIN}/robots.txt")
                robots_response.raise_for_status()
                robots = RobotFileParser()
                robots.set_url(f"{UFRET_ORIGIN}/robots.txt")
                robots.parse(robots_response.text.splitlines())
                if not robots.can_fetch(UFRET_USER_AGENT, f"{url}?key={query}"):
                    raise PermissionError
                response = await client.get(url, params={"key": query})
                response.raise_for_status()
                response.encoding = "utf-8"
        except PermissionError as error:
            raise HTTPException(status_code=403, detail="robots.txtでU-FRET検索の取得が許可されていません。") from error
        except httpx.HTTPError as error:
            raise HTTPException(status_code=502, detail="U-FRET検索へ接続できませんでした。") from error
        return {"items": parse_ufret_search_page(response.text)[:12]}

    @api.get("/ufret/import")
    async def ufret_import(url: str) -> dict[str, object]:
        try:
            normalized = normalize_ufret_song_url(url)
            source = await fetch_ufret_text(normalized)
            if re.search(r"var\s+chord_change\s*=", source):
                return parse_ufret_video_plus_page(source, normalized)

            result = parse_ufret_song_page(source, normalized)
            video_plus_url = find_ufret_video_plus_url(source)
            if video_plus_url:
                try:
                    video_plus_source = await fetch_ufret_text(video_plus_url)
                    video_plus = parse_ufret_video_plus_page(video_plus_source, video_plus_url)
                    if same_ufret_chord_sequence(str(result["chartText"]), str(video_plus["chartText"])):
                        result["timing"] = video_plus["timing"]
                except (PermissionError, ValueError, httpx.HTTPError, json.JSONDecodeError):
                    pass
            return result
        except PermissionError as error:
            raise HTTPException(status_code=403, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except (httpx.HTTPError, json.JSONDecodeError) as error:
            raise HTTPException(status_code=502, detail="U-FRETコード譜を取得できませんでした。") from error

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
