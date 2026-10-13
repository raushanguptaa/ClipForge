
import re
import shutil
import subprocess
import uuid
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.services.video_service import (
    get_video_info,
    split_video,
    trim_video,
)


app = FastAPI(
    title="ClipForge API",
    description="Video clipping and MP4 processing API",
    version="0.3.0",
)

app.add_middleware(
    CORSMiddleware,
    
allow_origins=[
    "http://localhost:3000",
    "https://clip-forge-rho-six.vercel.app",
    "https://clip-forge-555il251b-raushanguptaas-projects.vercel.app",],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent.parent
TEMP_DIR = BASE_DIR / "temp_uploads"
OUTPUT_DIR = BASE_DIR / "generated_clips"
TRIMMED_DIR = BASE_DIR / "generated_trimmed"

TEMP_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
TRIMMED_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024

ALLOWED_EXTENSIONS = {
    ".mp4",
    ".mov",
    ".mkv",
    ".webm",
    ".avi",
    ".m4v",
}


def find_source_video(video_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", video_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid video ID.",
        )

    matches = list(TEMP_DIR.glob(f"{video_id}.*"))

    if not matches or not matches[0].is_file():
        raise HTTPException(
            status_code=404,
            detail="Uploaded video not found. Please upload it again.",
        )

    return matches[0]


@app.get("/")
def root():
    return {
        "message": "ClipForge API is running",
        "status": "healthy",
    }


@app.get("/api/health")
def health_check():
    return {"status": "ok"}


@app.post("/api/videos/upload")
async def upload_video(file: UploadFile = File(...)):
    original_name = Path(file.filename or "").name
    extension = Path(original_name).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported video extension.",
        )

    video_id = uuid.uuid4().hex
    saved_path = TEMP_DIR / f"{video_id}{extension}"
    total_bytes = 0

    try:
        with saved_path.open("wb") as destination:
            while True:
                chunk = await file.read(CHUNK_SIZE)

                if not chunk:
                    break

                total_bytes += len(chunk)

                if total_bytes > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail="Maximum upload size is 2 GB.",
                    )

                destination.write(chunk)

        if total_bytes == 0:
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is empty.",
            )

        try:
            info = get_video_info(saved_path)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail="Could not read this video. Try a valid video file.",
            ) from exc

        return {
            "video_id": video_id,
            "filename": original_name,
            "size_bytes": total_bytes,
            "status": "uploaded",
            "video": info,
        }

    except HTTPException:
        saved_path.unlink(missing_ok=True)
        raise

    except Exception as exc:
        saved_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500,
            detail="Upload failed due to a server error.",
        ) from exc

    finally:
        await file.close()


@app.post("/api/videos/{video_id}/split")
def create_clips(
    video_id: str,
    duration: int = Form(...),
):
    if not 1 <= duration <= 3600:
        raise HTTPException(
            status_code=400,
            detail="Duration must be between 1 and 3600 seconds.",
        )

    source_path = find_source_video(video_id)
    output_dir = OUTPUT_DIR / video_id

    try:
        clips = split_video(
            source_path,
            output_dir,
            duration,
        )

        return {
            "video_id": video_id,
            "status": "completed",
            "clip_duration_seconds": duration,
            "total_clips": len(clips),
            "clips": clips,
            "zip_download_url": (
                f"/api/videos/{video_id}/download-zip"
            ),
        }

    except subprocess.TimeoutExpired as exc:
        shutil.rmtree(output_dir, ignore_errors=True)
        raise HTTPException(
            status_code=504,
            detail="Video processing timed out.",
        ) from exc

    except Exception as exc:
        shutil.rmtree(output_dir, ignore_errors=True)
        raise HTTPException(
            status_code=500,
            detail="Clip generation failed. Check FFmpeg and the video.",
        ) from exc


@app.post("/api/videos/{video_id}/trim")
def trim_video_endpoint(
    video_id: str,
    start_seconds: float = Form(...),
    end_seconds: float = Form(...),
):
    source_path = find_source_video(video_id)

    try:
        info = get_video_info(source_path)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="Could not read the uploaded video.",
        ) from exc

    if start_seconds < 0:
        raise HTTPException(
            status_code=400,
            detail="Start time cannot be negative.",
        )

    if end_seconds <= start_seconds:
        raise HTTPException(
            status_code=400,
            detail="End time must be greater than start time.",
        )

    if end_seconds > info["duration_seconds"]:
        raise HTTPException(
            status_code=400,
            detail=(
                "End time exceeds video duration "
                f"({info['duration_seconds']:.2f} seconds)."
            ),
        )

    output_dir = TRIMMED_DIR / video_id
    output_dir.mkdir(parents=True, exist_ok=True)

    filename = f"trim_{uuid.uuid4().hex[:12]}.mp4"
    output_path = output_dir / filename

    try:
        trimmed = trim_video(
            source_path,
            output_path,
            start_seconds,
            end_seconds,
        )

        return {
            "video_id": video_id,
            "status": "completed",
            **trimmed,
        }

    except subprocess.TimeoutExpired as exc:
        output_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=504,
            detail="Video trimming timed out.",
        ) from exc

    except ValueError as exc:
        output_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        output_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500,
            detail="Video trimming failed. Check FFmpeg and the video.",
        ) from exc


@app.get("/api/videos/trimmed/{video_id}/{filename}")
def download_trimmed_video(video_id: str, filename: str):
    if not re.fullmatch(r"[a-f0-9]{32}", video_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid video ID.",
        )

    if not re.fullmatch(r"trim_[a-f0-9]{12}\.mp4", filename):
        raise HTTPException(
            status_code=400,
            detail="Invalid trimmed video filename.",
        )

    output_path = TRIMMED_DIR / video_id / filename

    if not output_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Trimmed video not found.",
        )

    return FileResponse(
        path=output_path,
        media_type="video/mp4",
        filename=filename,
    )


@app.get("/api/videos/clips/{video_id}/{filename}")
def download_clip(video_id: str, filename: str):
    if not re.fullmatch(r"[a-f0-9]{32}", video_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid video ID.",
        )

    if not re.fullmatch(r"clip_[0-9]{3,}\.mp4", filename):
        raise HTTPException(
            status_code=400,
            detail="Invalid clip filename.",
        )

    clip_path = OUTPUT_DIR / video_id / filename

    if not clip_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Clip not found.",
        )

    return FileResponse(
        path=clip_path,
        media_type="video/mp4",
        filename=filename,
    )


@app.get("/api/videos/{video_id}/download-zip")
def download_all_clips(video_id: str):
    if not re.fullmatch(r"[a-f0-9]{32}", video_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid video ID.",
        )

    output_dir = OUTPUT_DIR / video_id

    if not output_dir.is_dir():
        raise HTTPException(
            status_code=404,
            detail="Generated clips not found.",
        )

    clip_files = sorted(output_dir.glob("clip_*.mp4"))

    if not clip_files:
        raise HTTPException(
            status_code=404,
            detail="No clips available.",
        )

    zip_path = OUTPUT_DIR / f"{video_id}.zip"

    with zipfile.ZipFile(
        zip_path,
        mode="w",
        compression=zipfile.ZIP_STORED,
    ) as archive:
        for clip_path in clip_files:
            archive.write(
                clip_path,
                arcname=clip_path.name,
            )

    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename="clipforge-clips.zip",
    )
