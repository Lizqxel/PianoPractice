import base64
import io
import wave

from fastapi.testclient import TestClient
from muscriptor.events import NoteEndEvent, NoteStartEvent, ProgressEvent

from local_server.app import MAX_REQUEST_BYTES, create_local_app


class FakeModel:
    _device = "cuda:0"

    def transcribe(self, _audio, **_kwargs):
        start = NoteStartEvent(pitch=60, start_time=0.0, index=1, instrument="acoustic_piano")
        yield ProgressEvent(completed=0, total=1)
        yield start
        yield NoteEndEvent(end_time=1.0, start_event=start)
        yield ProgressEvent(completed=1, total=1)

    def events_to_midi_bytes(self, _events):
        return b"MThd-fake-midi"


def make_client(tmp_path):
    app = create_local_app(
        FakeModel(),
        model_name="medium",
        device_name="cuda",
        youtube_api_key="",
        static_dir=tmp_path / "missing",
    )
    return TestClient(app)


def test_status_and_search_configuration(tmp_path):
    client = make_client(tmp_path)
    assert client.get("/api/status").json() == {
        "status": "ok",
        "model": "medium",
        "device": "cuda:0",
        "cudaAvailable": True,
        "youtubeSearchConfigured": False,
    }
    response = client.get("/api/youtube/search", params={"q": "test"})
    assert response.status_code == 503
    assert "YOUTUBE_API_KEY" in response.json()["detail"]


def test_official_sse_shape_and_midi_result(tmp_path):
    client = make_client(tmp_path)
    with client.stream(
        "POST",
        "/api/transcribe",
        files={"file": ("test.wav", tiny_wav(), "audio/wav")},
    ) as response:
        body = response.read().decode("utf-8")
    assert response.status_code == 200
    assert '"type": "progress"' in body
    assert '"type": "start"' in body
    assert '"type": "end"' in body
    assert base64.b64encode(b"MThd-fake-midi").decode("ascii") in body


def test_oversized_upload_is_rejected_before_decode(tmp_path):
    client = make_client(tmp_path)
    response = client.post(
        "/api/transcribe",
        content=b"",
        headers={"content-length": str(MAX_REQUEST_BYTES + 1)},
    )
    assert response.status_code == 413
    assert "250MB" in response.json()["detail"]


def tiny_wav():
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(b"\x00\x00" * 160)
    return buffer.getvalue()
