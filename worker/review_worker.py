"""PayPerWatch originality worker.

Checks every uploaded video before it can be published:
  1. Copy detection: 1 frame hash per second + a Chromaprint audio fingerprint, compared with
     every published video. Re-encodes, resizes, small crops and screen recordings still match.
  2. Topic overlap: the speech is transcribed (ffmpeg's whisper filter) and compared with other
     transcripts (TF-IDF cosine).
Originality = 100 x (1 - strongest match). A copy (>= 50% of the video matches) is blocked. A
score under 50 from topic overlap holds the video until the creator explains what it adds.

It also indexes published videos uploaded before the check existed, and the transcripts it
produces power transcript search and the paid agent API.

Needs: Python 3.10+, numpy, and an ffmpeg build with --enable-whisper and --enable-chromaprint.

  python worker/review_worker.py                       # poll the site in .env.local / PPW_URL
  python worker/review_worker.py --url https://ppv-studio.vercel.app
  python worker/review_worker.py --once                # one pass, then exit
  python worker/review_worker.py --compare a.mp4 b.mp4 # local test, no server

Env: REVIEW_WORKER_SECRET (required to talk to the site), PPW_URL, WHISPER_MODEL
(default worker/models/ggml-base.bin), WHISPER_PROCS (parallel transcription, default 4).
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures as cf
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"

# Thresholds
FRAME_MATCH_BITS = 10  # frames within this Hamming distance (of 64 bits) are the same picture
AUDIO_CHUNK = 48  # Chromaprint items per chunk (~6 s)
AUDIO_MATCH_BER = 0.25  # chunk bit-error rate below this = same audio
COPY_BLOCK = 0.5  # share of a video matching another one that makes it a copy
HOLD_BELOW = 50  # originality below this is held for an explanation
POLL_SECONDS = 20


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------------------------------------------------------------- config


def load_env():
    """KEY=VALUE pairs from .env then .env.local (later wins), without overriding real env vars."""
    vals: dict[str, str] = {}
    for name in (".env", ".env.local"):
        f = ROOT / name
        if f.exists():
            for line in f.read_text(encoding="utf8").splitlines():
                m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$", line)
                if m:
                    vals[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    for k, v in vals.items():
        os.environ.setdefault(k, v)


# ---------------------------------------------------------------- ffmpeg helpers


def run(cmd: list[str], cwd: str | None = None) -> bytes:
    p = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed: {p.stderr.decode(errors='replace')[-400:]}")
    return p.stdout


def probe(path: str) -> tuple[float, bool, bool]:
    out = json.loads(run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path]))
    kinds = {s.get("codec_type") for s in out.get("streams", [])}
    return float(out.get("format", {}).get("duration") or 0), "video" in kinds, "audio" in kinds


def frame_hashes(path: str) -> np.ndarray:
    """One 64-bit difference hash per second. 0 marks a blank frame (black, single colour)."""
    raw = run(["ffmpeg", "-v", "error", "-i", path, "-an", "-vf", "fps=1,scale=9:8:flags=area,format=gray", "-f", "rawvideo", "-"])
    px = np.frombuffer(raw, dtype=np.uint8)
    px = px[: len(px) // 72 * 72].reshape(-1, 8, 9).astype(np.int16)
    bits = (px[:, :, 1:] > px[:, :, :-1]).reshape(-1, 64)
    hashes = np.packbits(bits, axis=1).view(">u8").ravel().astype(np.uint64)
    blank = px.reshape(-1, 72).std(axis=1) < 6
    hashes[blank] = 0
    return hashes


def audio_fingerprint(path: str) -> np.ndarray:
    raw = run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-f", "chromaprint", "-fp_format", "raw", "-"])
    return np.frombuffer(raw[: len(raw) // 4 * 4], dtype="<u4").copy()


def filter_path(p: Path) -> str:
    """Escape a path for use as a filter option value (escaped once for the option, once for the graph)."""
    return str(p).replace("\\", "/").replace(":", "\\\\:")


NOISE = re.compile(r"^\s*[\(\[\*♪].*[\)\]\*♪]\s*$|^\s*$")


def transcribe(path: str, duration: float, model: Path, procs: int) -> list[dict]:
    """Speech -> [{start, end, text}] (seconds). Splits long audio across parallel whisper runs."""
    parts = max(1, min(procs, math.ceil(duration / 120)))
    span = duration / parts
    tmp = tempfile.mkdtemp(prefix="ppw-asr-")
    try:

        def one(i: int) -> list[dict]:
            start = i * span
            out = f"part{i}.json"
            af = f"aresample=16000,whisper=model={filter_path(model)}:language=auto:queue=20:use_gpu=false:destination={out}:format=json"
            run(["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{span + 0.5:.3f}", "-i", path, "-vn", "-af", af, "-f", "null", "-"], cwd=tmp)
            segs = []
            f = Path(tmp) / out
            if f.exists():
                for line in f.read_text(encoding="utf8", errors="replace").splitlines():
                    try:
                        s = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    text = str(s.get("text", "")).strip()
                    if NOISE.match(text):
                        continue
                    segs.append({"start": round(start + s["start"] / 1000, 2), "end": round(start + s["end"] / 1000, 2), "text": text})
            return segs

        with cf.ThreadPoolExecutor(parts) as ex:
            chunks = list(ex.map(one, range(parts)))
        return [s for c in chunks for s in c]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def analyze(path: str, model: Path, procs: int) -> dict:
    duration, has_video, has_audio = probe(path)
    t0 = time.time()
    with cf.ThreadPoolExecutor(3) as ex:
        f_frames = ex.submit(frame_hashes, path) if has_video else None
        f_audio = ex.submit(audio_fingerprint, path) if has_audio else None
        f_text = ex.submit(transcribe, path, duration, model, procs) if has_audio and model.exists() else None
        frames = f_frames.result() if f_frames else np.zeros(0, dtype=np.uint64)
        audio = f_audio.result() if f_audio else np.zeros(0, dtype=np.uint32)
        segments = f_text.result() if f_text else []
    log(f"  analyzed {duration / 60:.1f} min in {time.time() - t0:.0f}s: {len(frames)} frames, {len(audio)} audio items, {len(segments)} speech segments")
    return {"frames": frames, "audio": audio, "segments": segments, "transcript": " ".join(s["text"] for s in segments)}


# ---------------------------------------------------------------- comparison


def visual_overlap(a: np.ndarray, b: np.ndarray) -> float:
    """Share of a's (non-blank) seconds whose picture also appears somewhere in b."""
    a, b = a[a != 0], b[b != 0]
    if len(a) < 5 or len(b) < 5:
        return 0.0
    matched = 0
    for i in range(0, len(a), 512):
        d = np.bitwise_count(a[i : i + 512, None] ^ b[None, :])
        matched += int((d.min(axis=1) <= FRAME_MATCH_BITS).sum())
    return matched / len(a)


def audio_overlap(a: np.ndarray, b: np.ndarray) -> float:
    """Share of a's audio chunks that line up with b's audio at some offset."""
    if len(a) < AUDIO_CHUNK or len(b) < AUDIO_CHUNK:
        return 0.0
    where: dict[int, list[int]] = {}
    for pos, v in enumerate(b.tolist()):
        lst = where.setdefault(v, [])
        if len(lst) < 8:
            lst.append(pos)
    total = matched = 0
    for start in range(0, len(a) - AUDIO_CHUNK + 1, AUDIO_CHUNK):
        chunk = a[start : start + AUDIO_CHUNK]
        if len(np.unique(chunk)) < AUDIO_CHUNK // 4:
            continue  # silence or a constant tone
        total += 1
        votes = Counter(p - (start + i) for i, v in enumerate(chunk.tolist()) for p in where.get(v, ()))
        for off, _ in votes.most_common(3):
            lo = start + off
            if lo < 0 or lo + AUDIO_CHUNK > len(b):
                continue
            ber = np.bitwise_count(chunk ^ b[lo : lo + AUDIO_CHUNK]).sum() / (32 * AUDIO_CHUNK)
            if ber < AUDIO_MATCH_BER:
                matched += 1
                break
    return matched / total if total else 0.0


STOP = set(
    """the and for are but not you all any can had her was one our out day get has him his how man new now old see two way who
    boy did its let put say she too use that with have this will your from they know want been good much some time very when come
    here just like long make many over such take than them well were what into more only also back after first then there these
    their would about could which other because going really right think thing things okay yeah gonna actually people little
    something where those being does doing done should still even through while again before most same each both down off""".split()
)


def tokens(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z][a-z0-9']{2,}", text.lower()) if w not in STOP]


def topic_similarity(doc: list[str], others: list[list[str]]) -> list[float]:
    """TF-IDF cosine of doc against each of others."""
    if len(doc) < 30:
        return [0.0] * len(others)
    corpus = [doc] + others
    df = Counter(w for d in corpus for w in set(d))
    n = len(corpus)

    def vec(d: list[str]) -> dict[str, float]:
        tf = Counter(d)
        v = {w: (1 + math.log(c)) * (math.log((n + 1) / (df[w] + 1)) + 1) for w, c in tf.items()}
        norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        return {w: x / norm for w, x in v.items()}

    q = vec(doc)
    out = []
    for d in others:
        if len(d) < 30:
            out.append(0.0)
            continue
        v = vec(d)
        out.append(sum(x * v.get(w, 0.0) for w, x in q.items()))
    return out


def judge(new: dict, title: str, description: str, published: list[dict]) -> dict:
    new_doc = tokens(f"{title} {description} {new['transcript']}")
    topics = topic_similarity(new_doc, [tokens(f"{p['title']} {p['transcript']}") for p in published])
    matches = []
    worst_copy = worst_topic = 0.0
    for p, topic in zip(published, topics):
        copy = max(visual_overlap(new["frames"], p["frames"]), audio_overlap(new["audio"], p["audio"]))
        worst_copy, worst_topic = max(worst_copy, copy), max(worst_topic, topic)
        kind, sim = ("copy", copy) if copy >= 0.2 or copy >= topic else ("topic", topic)
        if sim >= 0.2:
            matches.append({"content_cid": p["id"], "video_id": p.get("video_id"), "title": p["title"], "creator": p["creator"], "kind": kind, "similarity": round(sim, 3)})
    matches.sort(key=lambda m: m["similarity"], reverse=True)
    score = round(100 * (1 - max(worst_copy, worst_topic)))
    verdict = "blocked" if worst_copy >= COPY_BLOCK else "held" if score < HOLD_BELOW else "passed"
    return {"verdict": verdict, "score": score, "matches": matches[:5]}


# ---------------------------------------------------------------- server I/O


class Site:
    def __init__(self, url: str, secret: str):
        self.url, self.secret = url.rstrip("/"), secret

    def call(self, path: str, body: dict | None = None):
        req = urllib.request.Request(
            self.url + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
            method="POST" if body is not None else "GET",
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())

    def published_entries(self, published: list[dict]) -> list[dict]:
        """Fingerprints of published videos, cached on disk (they never change)."""
        CACHE.mkdir(exist_ok=True)
        out = []
        for p in published:
            f = CACHE / (hashlib.sha1(p["id"].encode()).hexdigest() + ".json")
            if f.exists():
                e = json.loads(f.read_text(encoding="utf8"))
            else:
                e = self.call("/api/reviews/worker/index/" + urllib.request.quote(p["id"], safe=""))["entry"]
                f.write_text(json.dumps(e), encoding="utf8")
            out.append(decode_entry(e) | {"video_id": p["video_id"]})
        return out


def encode_entry(a: dict) -> dict:
    return {
        "frames": "".join(f"{int(h):016x}" for h in a["frames"]),
        "audio": base64.b64encode(a["audio"].astype("<u4").tobytes()).decode(),
        "transcript": a["transcript"],
        "segments": a["segments"],
    }


def decode_entry(e: dict) -> dict:
    fr = e.get("frames") or ""
    frames = np.array([int(fr[i : i + 16], 16) for i in range(0, len(fr), 16)], dtype=np.uint64)
    audio = np.frombuffer(base64.b64decode(e.get("audio") or ""), dtype="<u4").copy()
    return {"id": e["id"], "title": e.get("title", ""), "creator": e.get("creator", ""), "frames": frames, "audio": audio, "transcript": e.get("transcript", "")}


def download(url: str, dest: str):
    with urllib.request.urlopen(url, timeout=120) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)


def process(site: Site, job: dict, kind: str, published: list[dict], model: Path, procs: int):
    log(f"{'checking' if kind == 'review' else 'indexing'} {job['title']!r}")
    tmp = tempfile.mkdtemp(prefix="ppw-review-")
    body: dict = {"kind": kind, "id": job["id"]} | ({"videoId": job["videoId"]} if kind == "index" else {})
    try:
        path = os.path.join(tmp, "video")
        download(job["downloadUrl"], path)
        a = analyze(path, model, procs)
        body["entry"] = encode_entry(a)
        if kind == "review":
            others = [p for p in published if p["id"] != job["id"]]
            body["result"] = judge(a, job["title"], job.get("description", ""), others)
            log(f"  -> {body['result']['verdict']} (originality {body['result']['score']})")
    except Exception as e:  # report and move on; the site marks the review as failed
        log(f"  failed: {e}")
        body["error"] = str(e)[:500]
        body.pop("entry", None)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    site.call("/api/reviews/worker", body)


def loop(site: Site, model: Path, procs: int, once: bool):
    if not model.exists():
        log(f"warning: whisper model not found at {model}; transcripts (topic check, agent API) will be empty")
    log(f"watching {site.url}")
    while True:
        try:
            state = site.call("/api/reviews/worker")
            # Index existing videos first, so new uploads are judged against all of them.
            if state["backfill"]:
                for job in state["backfill"]:
                    process(site, job, "index", [], model, procs)
                continue
            if state["jobs"]:
                published = site.published_entries(state["published"])
                for job in state["jobs"]:
                    process(site, job, "review", published, model, procs)
                continue  # look for more right away
        except urllib.error.HTTPError as e:
            log(f"site error {e.code}: {e.read()[:200]!r}")
            if e.code == 401:
                sys.exit("REVIEW_WORKER_SECRET doesn't match the site's.")
        except (urllib.error.URLError, TimeoutError) as e:
            log(f"can't reach the site: {e}")
        if once:
            return
        time.sleep(POLL_SECONDS)


def compare_files(a_path: str, b_path: str, model: Path, procs: int):
    a, b = analyze(a_path, model, procs), analyze(b_path, model, procs)
    b_entry = {"id": "b", "title": Path(b_path).stem, "creator": "", "video_id": None} | b
    print(json.dumps({
        "visual": round(visual_overlap(a["frames"], b["frames"]), 3),
        "audio": round(audio_overlap(a["audio"], b["audio"]), 3),
        "result": judge(a, Path(a_path).stem, "", [b_entry]),
    }, indent=2))


def main():
    load_env()
    ap = argparse.ArgumentParser(description="PayPerWatch originality worker")
    ap.add_argument("--url", default=os.environ.get("PPW_URL") or os.environ.get("NEXT_PUBLIC_APP_URL") or "http://localhost:3000")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--compare", nargs=2, metavar=("NEW", "EXISTING"))
    args = ap.parse_args()
    model = Path(os.environ.get("WHISPER_MODEL") or HERE / "models" / "ggml-base.bin")
    procs = int(os.environ.get("WHISPER_PROCS") or 4)
    if args.compare:
        compare_files(*args.compare, model, procs)
        return
    secret = os.environ.get("REVIEW_WORKER_SECRET")
    if not secret:
        sys.exit("Set REVIEW_WORKER_SECRET (the same value as on the site).")
    loop(Site(args.url, secret), model, procs, args.once)


if __name__ == "__main__":
    main()
