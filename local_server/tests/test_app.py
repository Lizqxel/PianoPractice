import base64
import io
import wave

from fastapi.testclient import TestClient
from muscriptor.events import NoteEndEvent, NoteStartEvent, ProgressEvent

from local_server.app import (
    MAX_REQUEST_BYTES,
    create_local_app,
    find_ufret_video_plus_url,
    normalize_ufret_song_url,
    parse_ufret_search_page,
    parse_ufret_song_page,
    parse_ufret_video_plus_page,
)


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


def test_ufret_song_parser_returns_chords_without_lyrics():
    source = """
    <title>常夜燈 / PEOPLE1 ギターコード - U-FRET</title>
    <script>
    var ytID = 'OZpv_AcPCKg';
    const defaultBpm = "99";
    var ufret_chord_datas = ["[B♭]歌詞[F/C]歌詞", "[Am7-5]歌詞[D7]歌詞"];
    </script>
    """
    parsed = parse_ufret_song_page(source, "https://www.ufret.jp/song.php?data=69641")
    assert parsed == {
        "title": "常夜燈",
        "artist": "PEOPLE1",
        "url": "https://www.ufret.jp/song.php?data=69641",
        "version": "通常ver",
        "chartText": "Bb F/C | Am7-5 D7",
        "bpm": 99,
        "chordCount": 4,
        "youtubeVideoId": "OZpv_AcPCKg",
    }
    assert "歌詞" not in parsed["chartText"]


def test_ufret_search_parser_and_url_allowlist():
    source = """
    <li class="c-list__item normal-chord"><a href="/song.php?data=69641">
      <p class="c-list__title">常夜燈</p><p class="c-list__artist">PEOPLE1</p>
    </a></li>
    """
    assert parse_ufret_search_page(source) == [{
        "title": "常夜燈",
        "artist": "PEOPLE1",
        "url": "https://www.ufret.jp/song.php?data=69641",
        "version": "通常ver",
    }]
    assert normalize_ufret_song_url("https://ufret.jp/song.php?data=69641#content") == "https://www.ufret.jp/song.php?data=69641"


def test_ufret_video_plus_parser_returns_beat_map():
    source = """
    <title>常夜燈 (動画プラス) / PEOPLE1 ギターコード - U-FRET</title>
    <a href="/song.php?data=71624">動画プラスでMVに合わせて楽譜を表示</a>
    <div id="blyodnijb">
      <p class="atfolhyds"><ruby><rt>B♭</rt></ruby><ruby><rt>F</rt></ruby></p>
      <p class="atfolhyds"><ruby><rt>Gm</rt></ruby></p>
    </div>
    <script>
    var ytID = 'OZpv_AcPCKg';
    var chord_change = '099009';
    var song_bpm = Number('99');
    var start_chord = Number('2675') / 1000;
    var tempo_change = JSON.parse('["128,101"]');
    </script>
    """
    parsed = parse_ufret_video_plus_page(source, "https://www.ufret.jp/song.php?data=71624")
    assert parsed["chartText"] == "Bb F | Gm"
    assert parsed["chordCount"] == 3
    assert parsed["timing"] == {
        "sourceUrl": "https://www.ufret.jp/song.php?data=71624",
        "youtubeVideoId": "OZpv_AcPCKg",
        "bpm": 99.0,
        "startChord": 2.675,
        "chordChange": "099009",
        "tempoChanges": ["128,101"],
    }


def test_find_ufret_video_plus_url_uses_labeled_link():
    source = '<a href="/song.php?data=71624">動画プラスで曲を聴きながら弾く</a>'
    assert find_ufret_video_plus_url(source) == "https://www.ufret.jp/song.php?data=71624"


def tiny_wav():
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(b"\x00\x00" * 160)
    return buffer.getvalue()
