
import json
import shutil
import subprocess
from pathlib import Path


FFPROBE = "ffprobe"
FFMPEG = "ffmpeg"


def get_video_info(file_path: Path) -> dict:
    command = [
        FFPROBE,
        "-v", "error",
        "-show_entries",
        "format=duration,format_name:stream=codec_type,codec_name,width,height",
        "-of", "json",
        str(file_path),
    ]

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )

    data = json.loads(result.stdout)
    streams = data.get("streams", [])

    video_stream = next(
        (stream for stream in streams if stream.get("codec_type") == "video"),
        None,
    )

    if not video_stream:
        raise ValueError("No video stream found.")

    duration = float(data.get("format", {}).get("duration", 0))

    if duration <= 0:
        raise ValueError("Invalid video duration.")

    return {
        "duration_seconds": duration,
        "duration_minutes": round(duration / 60, 2),
        "format": data.get("format", {}).get("format_name", "unknown"),
        "width": video_stream.get("width"),
        "height": video_stream.get("height"),
        "video_codec": video_stream.get("codec_name"),
    }


def split_video(
    source_path: Path,
    output_dir: Path,
    clip_duration: int,
) -> list[dict]:
    video_info = get_video_info(source_path)
    total_duration = video_info["duration_seconds"]

    if clip_duration < 1:
        raise ValueError("Clip duration must be at least one second.")

    output_dir.mkdir(parents=True, exist_ok=True)

    for old_file in output_dir.iterdir():
        if old_file.is_file() or old_file.is_symlink():
            old_file.unlink()
        elif old_file.is_dir():
            shutil.rmtree(old_file)

    clips = []
    start_time = 0.0
    clip_number = 1

    while start_time < total_duration:
        current_duration = min(
            float(clip_duration),
            total_duration - start_time,
        )

        filename = f"clip_{clip_number:03d}.mp4"
        output_path = output_dir / filename

        command = [
            FFMPEG,
            "-hide_banner",
            "-loglevel", "error",
            "-y",
            "-ss", str(start_time),
            "-i", str(source_path),
            "-t", str(current_duration),
            "-map", "0:v:0",
            "-map", "0:a:0?",
            "-sn",
            "-dn",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            "-threads", "2",
            str(output_path),
        ]

        try:
            subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=3600,
                check=True,
            )

            if not output_path.exists() or output_path.stat().st_size == 0:
                raise RuntimeError("FFmpeg produced an empty clip.")

        except Exception:
            output_path.unlink(missing_ok=True)
            raise

        clips.append({
            "clip_number": clip_number,
            "filename": filename,
            "start_seconds": round(start_time, 2),
            "duration_seconds": round(current_duration, 2),
            "size_bytes": output_path.stat().st_size,
            "download_url": (
                f"/api/videos/clips/{source_path.stem}/{filename}"
            ),
        })

        start_time += current_duration
        clip_number += 1

    return clips


def trim_video(
    source_path: Path,
    output_path: Path,
    start_seconds: float,
    end_seconds: float,
) -> dict:
    video_info = get_video_info(source_path)
    total_duration = video_info["duration_seconds"]

    if start_seconds < 0:
        raise ValueError("Start time cannot be negative.")

    if end_seconds <= start_seconds:
        raise ValueError("End time must be greater than start time.")

    if end_seconds > total_duration:
        raise ValueError(
            f"End time exceeds video duration ({total_duration:.2f} seconds)."
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)

    clip_duration = end_seconds - start_seconds

    command = [
        FFMPEG,
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-ss", str(start_seconds),
        "-i", str(source_path),
        "-t", str(clip_duration),
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-sn",
        "-dn",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-threads", "2",
        str(output_path),
    ]

    try:
        subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=3600,
            check=True,
        )

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("FFmpeg produced an empty trimmed video.")

    except Exception:
        output_path.unlink(missing_ok=True)
        raise

    return {
        "filename": output_path.name,
        "start_seconds": start_seconds,
        "end_seconds": end_seconds,
        "duration_seconds": round(clip_duration, 2),
        "size_bytes": output_path.stat().st_size,
        "download_url": (
            f"/api/videos/trimmed/{source_path.stem}/{output_path.name}"
        ),
    }
