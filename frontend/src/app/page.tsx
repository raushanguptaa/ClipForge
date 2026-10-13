
"use client";

import { useEffect, useRef, useState } from "react";

type VideoInfo = {
  duration_seconds: number;
  duration_minutes: number;
  format: string;
  width: number;
  height: number;
  video_codec: string;
};

type UploadResult = {
  video_id: string;
  filename: string;
  size_bytes: number;
  status: string;
  video: VideoInfo;
};

type ClipItem = {
  filename?: string;
  download_url?: string;
  url?: string;
  duration_seconds?: number;
  [key: string]: unknown;
};

type SplitResult = {
  video_id: string;
  status: string;
  clip_duration_seconds: number;
  total_clips: number;
  clips: Array<string | ClipItem>;
  zip_download_url: string;
};

type TrimResult = {
  video_id: string;
  status: string;
  filename: string;
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
  size_bytes: number;
  download_url: string;
};


const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";


function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(seconds: number) {
  const total = Math.floor(Math.max(0, seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  const [durationChoice, setDurationChoice] = useState("30");
  const [customDuration, setCustomDuration] = useState("30");
  const [splitting, setSplitting] = useState(false);
  const [splitResult, setSplitResult] = useState<SplitResult | null>(null);

  const [startSeconds, setStartSeconds] = useState("0");
  const [endSeconds, setEndSeconds] = useState("15");
  const [trimming, setTrimming] = useState(false);
  const [trimResult, setTrimResult] = useState<TrimResult | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  function selectFile(selectedFile?: File) {
    if (!selectedFile) return;

    if (
      !selectedFile.type.startsWith("video/") &&
      !/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(selectedFile.name)
    ) {
      setError("Please choose a valid video file.");
      return;
    }

    setFile(selectedFile);
    setResult(null);
    setSplitResult(null);
    setTrimResult(null);
    setError("");
    setProgress(0);
    setStartSeconds("0");
    setEndSeconds("15");
    setIsMuted(false);
  }

  function resetFile() {
    if (uploading || splitting || trimming) return;

    setFile(null);
    setResult(null);
    setSplitResult(null);
    setTrimResult(null);
    setError("");
    setProgress(0);
    setIsMuted(false);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function uploadVideo() {
    if (!file || uploading) return;

    setUploading(true);
    setProgress(0);
    setError("");
    setResult(null);
    setSplitResult(null);
    setTrimResult(null);

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/videos/upload`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      setUploading(false);

      let response: Record<string, unknown>;

      try {
        response = JSON.parse(xhr.responseText);
      } catch {
        setError("The server returned an invalid response.");
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        const uploaded = response as unknown as UploadResult;

        setResult(uploaded);
        setProgress(100);

        setEndSeconds(
          String(
            Math.max(
              0.1,
              Math.min(
                15,
                Math.floor(uploaded.video.duration_seconds * 10) / 10
              )
            )
          )
        );
      } else {
        setError(
          typeof response.detail === "string"
            ? response.detail
            : "Upload failed. Please try again."
        );
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setError(
        "Cannot connect to ClipForge API. Check that the backend is running."
      );
    };

    xhr.onabort = () => {
      setUploading(false);
      setError("Upload was cancelled.");
    };

    xhr.send(formData);
  }

  async function generateClips() {
    if (!result || splitting) return;

    const duration =
      durationChoice === "custom"
        ? Number(customDuration)
        : Number(durationChoice);

    if (
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 3600
    ) {
      setError("Enter a whole-number duration from 1 to 3600 seconds.");
      return;
    }

    setSplitting(true);
    setError("");
    setSplitResult(null);

    try {
      const formData = new FormData();
      formData.append("duration", String(duration));

      const response = await fetch(
        `${API_URL}/api/videos/${result.video_id}/split`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Clip generation failed."
        );
      }

      setSplitResult(data as SplitResult);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not connect to ClipForge API."
      );
    } finally {
      setSplitting(false);
    }
  }

  async function trimVideo() {
    if (!result || trimming) return;

    const start = Number(startSeconds);
    const end = Number(endSeconds);

    if (
      startSeconds.trim() === "" ||
      endSeconds.trim() === "" ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start
    ) {
      setError("End time must be greater than start time.");
      return;
    }

    if (end > result.video.duration_seconds) {
      setError("End time cannot exceed the video duration.");
      return;
    }

    setTrimming(true);
    setError("");
    setTrimResult(null);

    try {
      const formData = new FormData();
      formData.append("start_seconds", String(start));
      formData.append("end_seconds", String(end));

      const response = await fetch(
        `${API_URL}/api/videos/${result.video_id}/trim`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Video trimming failed."
        );
      }

      setTrimResult(data as TrimResult);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not connect to ClipForge API."
      );
    } finally {
      setTrimming(false);
    }
  }

  function getClipFilename(clip: string | ClipItem, index: number) {
    const fallback = `clip_${String(index + 1).padStart(3, "0")}.mp4`;

    if (typeof clip === "string") {
      return clip.split("/").pop() || fallback;
    }

    if (typeof clip.filename === "string") {
      return clip.filename;
    }

    const candidate = clip.download_url || clip.url;

    if (typeof candidate === "string") {
      return candidate.split("/").pop() || fallback;
    }

    return fallback;
  }

  function getClipUrl(clip: string | ClipItem, index: number) {
    const filename = getClipFilename(clip, index);

    if (typeof clip === "object") {
      const candidate = clip.download_url || clip.url;

      if (typeof candidate === "string") {
        return candidate.startsWith("http")
          ? candidate
          : `${API_URL}${candidate.startsWith("/") ? "" : "/"}${candidate}`;
      }
    }

    if (typeof clip === "string" && clip.startsWith("http")) {
      return clip;
    }

    return `${API_URL}/api/videos/clips/${result?.video_id}/${filename}`;
  }

  function seekPreview(seconds: number) {
    if (videoRef.current && Number.isFinite(seconds)) {
      videoRef.current.currentTime = seconds;
    }
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;

    video.muted = !video.muted;
    setIsMuted(video.muted);
  }

  return (
    <main className="min-h-screen">
      <nav className="navbar">
        <a className="brand" href="#">
          <span className="brand-mark">C</span>
          CLIPFORGE<span className="brand-dot">.</span>
        </a>

        <div className="nav-links">
          <a href="#features">FEATURES</a>
          <a href="#how-it-works">HOW IT WORKS</a>
          <a className="nav-cta" href="#upload">
            START CLIPPING ↗
          </a>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            YOUR CREATIVE WORKSHOP
          </div>

          <h1>
            YOUR VIDEO.
            <br />
            YOUR CUT.
            <br />
            <span>YOUR UNIVERSE.</span>
          </h1>

          <p className="hero-description">
            Turn long videos into perfectly timed clips. Make every second
            count, your way.
          </p>

          <a className="primary-button" href="#upload">
            START CLIPPING <span>↗</span>
          </a>

          <div className="hero-note">
            <span>✳</span> YOUR VIDEOS. YOUR RULES.
          </div>
        </div>

        <div
          className="hero-art"
          aria-label="ClipForge comic-style video artwork"
        >
          <div className="art-sunburst" />

          <div className="art-panel">
            <div className="art-label">ROLL CAMERA!</div>
            <div className="art-screen">
              <div className="art-mountain mountain-back" />
              <div className="art-mountain mountain-front" />
              <div className="art-sun" />
              <div className="art-play">▶</div>
            </div>
            <div className="art-caption">CUT THE BORING. KEEP THE GOLD.</div>
          </div>

          <div className="art-sticker">
            100%
            <br />
            YOUR CUT
          </div>

          <div className="art-spark spark-one">✳</div>
          <div className="art-spark spark-two">✦</div>
        </div>
      </section>

      <section className="upload-section" id="upload">
        <div className="section-heading">
          <div className="eyebrow">LET&apos;S MAKE SOMETHING</div>
          <h2>DROP YOUR VIDEO.</h2>
          <p>Start with one video. We&apos;ll take it from there.</p>
        </div>

        <div
          className={`upload-box ${dragging ? "is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            selectFile(event.dataTransfer.files[0]);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*,.mkv,.avi,.m4v"
            hidden
            onChange={(event) => {
              selectFile(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />

          {!file ? (
            <>
              <button
                type="button"
                className="upload-icon"
                aria-label="Choose a video file"
                onClick={() => inputRef.current?.click()}
              >
                ↑
              </button>

              <h3>YOUR NEXT GREAT CLIP STARTS HERE.</h3>
              <p>Drag and drop your video here, or browse files.</p>

              <button
                type="button"
                className="primary-button"
                onClick={() => inputRef.current?.click()}
              >
                <span aria-hidden="true">📁</span>
                CHOOSE VIDEO
                <span aria-hidden="true">↗</span>
              </button>

              <div className="upload-formats">
                MP4 · MOV · MKV · WEBM · AVI
              </div>
            </>
          ) : (
            <>
              <div className="upload-icon">{result ? "✓" : "▶"}</div>
              <h3 className="selected-filename">{file.name}</h3>
              <p>{formatSize(file.size)}</p>

              {uploading && (
                <div className="progress-area">
                  <div className="progress-label">
                    <span>UPLOADING VIDEO...</span>
                    <span>{progress}%</span>
                  </div>
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="progress-fill"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              {!result && (
                <div className="upload-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={uploading}
                    onClick={uploadVideo}
                  >
                    {uploading ? "UPLOADING..." : "UPLOAD VIDEO"}
                    {!uploading && <span aria-hidden="true">↗</span>}
                  </button>

                  <button
                    type="button"
                    className="secondary-button"
                    disabled={uploading}
                    onClick={resetFile}
                  >
                    <span aria-hidden="true">✕</span>
                    REMOVE
                  </button>
                </div>
              )}

              {result && (
                <div className="video-result">
                  <div className="result-success">
                    ✓ VIDEO UPLOADED SUCCESSFULLY
                  </div>

                  <div className="video-stats">
                    <div>
                      <span>DURATION</span>
                      <strong>
                        {formatDuration(result.video.duration_seconds)}
                      </strong>
                    </div>
                    <div>
                      <span>RESOLUTION</span>
                      <strong>
                        {result.video.width} × {result.video.height}
                      </strong>
                    </div>
                    <div>
                      <span>FORMAT</span>
                      <strong>{result.video.video_codec.toUpperCase()}</strong>
                    </div>
                  </div>

                  <div
                    className="clip-controls"
                    style={{ marginTop: "1.5rem", textAlign: "left" }}
                  >
                    <h3>VIDEO PREVIEW</h3>
                    <p>Watch your video and choose the exact moment to keep.</p>

                    {previewUrl && (
                      <div>
                        <video
                          ref={videoRef}
                          src={previewUrl}
                          controls
                          muted={isMuted}
                          onVolumeChange={(event) => {
                            setIsMuted(event.currentTarget.muted);
                          }}
                          preload="metadata"
                          onLoadedMetadata={(event) => {
                            const actualDuration =
                              event.currentTarget.duration;

                            if (Number.isFinite(actualDuration)) {
                              setEndSeconds((previous) =>
                                String(
                                  Math.min(
                                    Math.max(Number(previous) || 15, 0.1),
                                    actualDuration
                                  )
                                )
                              );
                            }
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            maxHeight: "420px",
                            background: "#111",
                            marginTop: "1rem",
                          }}
                        />

                        <button
                          type="button"
                          className="secondary-button"
                          aria-label={isMuted ? "Unmute video" : "Mute video"}
                          aria-pressed={isMuted}
                          onClick={toggleMute}
                          style={{ marginTop: "0.75rem" }}
                        >
                          {isMuted ? "🔇 UNMUTE VIDEO" : "🔊 MUTE VIDEO"}
                        </button>
                      </div>
                    )}

                    <div style={{ marginTop: "1.5rem" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "1rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <label htmlFor="visual-start">
                          START: {formatDuration(Number(startSeconds) || 0)}
                        </label>
                        <label htmlFor="visual-end">
                          END: {formatDuration(Number(endSeconds) || 0)}
                        </label>
                      </div>

                      <div style={{ marginTop: "1rem" }}>
                        <label htmlFor="visual-start">START POINT</label>
                        <input
                          id="visual-start"
                          type="range"
                          min="0"
                          max={result.video.duration_seconds}
                          step="0.1"
                          value={Math.min(
                            Number(startSeconds) || 0,
                            result.video.duration_seconds
                          )}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            setStartSeconds(String(value));

                            if (value >= Number(endSeconds)) {
                              setEndSeconds(
                                String(
                                  Math.min(
                                    result.video.duration_seconds,
                                    value + 0.1
                                  )
                                )
                              );
                            }

                            seekPreview(value);
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            marginTop: "0.5rem",
                          }}
                        />
                      </div>

                      <div style={{ marginTop: "1rem" }}>
                        <label htmlFor="visual-end">END POINT</label>
                        <input
                          id="visual-end"
                          type="range"
                          min="0"
                          max={result.video.duration_seconds}
                          step="0.1"
                          value={Math.min(
                            Number(endSeconds) || 0,
                            result.video.duration_seconds
                          )}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            setEndSeconds(String(value));
                            seekPreview(value);
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            marginTop: "0.5rem",
                          }}
                        />
                      </div>

                      <div
                        style={{
                          marginTop: "1rem",
                          padding: "0.75rem",
                          border: "1px dashed currentColor",
                        }}
                      >
                        <strong>
                          SELECTED CLIP:{" "}
                          {formatDuration(
                            Math.max(
                              0,
                              (Number(endSeconds) || 0) -
                                (Number(startSeconds) || 0)
                            )
                          )}
                        </strong>
                        <p style={{ marginTop: "0.35rem" }}>
                          From {formatDuration(Number(startSeconds) || 0)} to{" "}
                          {formatDuration(Number(endSeconds) || 0)}
                        </p>
                      </div>

                      <button
                        type="button"
                        className="secondary-button"
                        style={{ marginTop: "1rem" }}
                        onClick={() => {
                          if (videoRef.current) {
                            videoRef.current.currentTime =
                              Number(startSeconds) || 0;
                            void videoRef.current.play();
                          }
                        }}
                      >
                        ▶ PREVIEW FROM START POINT
                      </button>
                    </div>
                  </div>

                  <div
                    className="clip-controls"
                    style={{ marginTop: "1.5rem", textAlign: "left" }}
                  >
                    <h3>PRECISION CUT</h3>
                    <p>Adjust the exact start and end times.</p>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(140px, 1fr))",
                        gap: "1rem",
                        marginTop: "1rem",
                      }}
                    >
                      <div>
                        <label htmlFor="trim-start">START TIME (SECONDS)</label>
                        <input
                          id="trim-start"
                          type="number"
                          min="0"
                          max={result.video.duration_seconds}
                          step="0.1"
                          value={startSeconds}
                          onChange={(event) => {
                            const value = event.target.value;
                            setStartSeconds(value);

                            if (
                              value !== "" &&
                              Number.isFinite(Number(value))
                            ) {
                              seekPreview(Number(value));
                            }
                          }}
                          disabled={trimming}
                          style={{
                            display: "block",
                            width: "100%",
                            marginTop: "0.5rem",
                            padding: "0.75rem",
                          }}
                        />
                      </div>

                      <div>
                        <label htmlFor="trim-end">END TIME (SECONDS)</label>
                        <input
                          id="trim-end"
                          type="number"
                          min="0.1"
                          max={result.video.duration_seconds}
                          step="0.1"
                          value={endSeconds}
                          onChange={(event) => {
                            const value = event.target.value;
                            setEndSeconds(value);

                            if (
                              value !== "" &&
                              Number.isFinite(Number(value))
                            ) {
                              seekPreview(Number(value));
                            }
                          }}
                          disabled={trimming}
                          style={{
                            display: "block",
                            width: "100%",
                            marginTop: "0.5rem",
                            padding: "0.75rem",
                          }}
                        />
                      </div>
                    </div>

                    <p style={{ marginTop: "0.75rem" }}>
                      Video duration:{" "}
                      {formatDuration(result.video.duration_seconds)}
                    </p>

                    <button
                      type="button"
                      className="primary-button"
                      onClick={trimVideo}
                      disabled={trimming}
                      style={{ marginTop: "1rem" }}
                    >
                      {trimming ? "TRIMMING VIDEO..." : "TRIM VIDEO"}
                      {!trimming && <span aria-hidden="true">↗</span>}
                    </button>

                    {trimming && (
                      <p role="status" style={{ marginTop: "0.75rem" }}>
                        Trimming your video. Please keep this page open.
                      </p>
                    )}

                    {trimResult && (
                      <div style={{ marginTop: "1rem" }}>
                        <p className="result-success">
                          ✓ TRIM COMPLETE —{" "}
                          {formatDuration(trimResult.duration_seconds)}
                        </p>
                        <a
                          className="primary-button"
                          href={`${API_URL}${trimResult.download_url}`}
                          download={trimResult.filename}
                          style={{ marginTop: "0.75rem" }}
                        >
                          DOWNLOAD TRIMMED VIDEO ↗
                        </a>
                      </div>
                    )}
                  </div>

                  <div
                    className="clip-controls"
                    style={{ marginTop: "2rem", textAlign: "left" }}
                  >
                    <h3>MAKE YOUR CLIPS</h3>
                    <p>Choose how long each clip should be.</p>

                    <label
                      htmlFor="clip-duration"
                      style={{ display: "block", marginTop: "1rem" }}
                    >
                      CLIP DURATION
                    </label>

                    <select
                      id="clip-duration"
                      value={durationChoice}
                      onChange={(event) =>
                        setDurationChoice(event.target.value)
                      }
                      disabled={splitting}
                      style={{
                        width: "100%",
                        marginTop: "0.5rem",
                        padding: "0.75rem",
                      }}
                    >
                      <option value="10">10 seconds</option>
                      <option value="15">15 seconds</option>
                      <option value="30">30 seconds</option>
                      <option value="60">60 seconds</option>
                      <option value="90">90 seconds</option>
                      <option value="custom">Custom duration</option>
                    </select>

                    {durationChoice === "custom" && (
                      <div style={{ marginTop: "0.75rem" }}>
                        <label htmlFor="custom-duration">
                          CUSTOM DURATION (SECONDS)
                        </label>
                        <input
                          id="custom-duration"
                          type="number"
                          min="1"
                          max="3600"
                          step="1"
                          value={customDuration}
                          onChange={(event) =>
                            setCustomDuration(event.target.value)
                          }
                          disabled={splitting}
                          style={{
                            display: "block",
                            width: "100%",
                            marginTop: "0.5rem",
                            padding: "0.75rem",
                          }}
                        />
                      </div>
                    )}

                    <button
                      type="button"
                      className="primary-button"
                      onClick={generateClips}
                      disabled={splitting}
                      style={{ marginTop: "1rem" }}
                    >
                      {splitting ? "GENERATING CLIPS..." : "GENERATE CLIPS"}
                      {!splitting && <span aria-hidden="true">↗</span>}
                    </button>

                    {splitting && (
                      <p role="status" style={{ marginTop: "0.75rem" }}>
                        Processing your video. Please keep this page open.
                      </p>
                    )}

                    {splitResult && (
                      <div style={{ marginTop: "1.5rem" }}>
                        <p className="result-success">
                          ✓ {splitResult.total_clips} CLIPS GENERATED
                        </p>

                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "0.75rem",
                            margin: "1rem 0",
                          }}
                        >
                          <a
                            className="primary-button"
                            href={`${API_URL}${splitResult.zip_download_url}`}
                          >
                            DOWNLOAD ALL (ZIP) ↗
                          </a>
                        </div>

                        <div style={{ display: "grid", gap: "0.75rem" }}>
                          {splitResult.clips.map((clip, index) => {
                            const filename = getClipFilename(clip, index);
                            const clipUrl = getClipUrl(clip, index);

                            return (
                              <div
                                key={`${filename}-${index}`}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  gap: "1rem",
                                  padding: "0.85rem",
                                  border: "1px solid currentColor",
                                  flexWrap: "wrap",
                                }}
                              >
                                <span>{filename}</span>
                                <a
                                  className="secondary-button"
                                  href={clipUrl}
                                  download={filename}
                                >
                                  DOWNLOAD CLIP
                                </a>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={resetFile}
                    disabled={trimming || splitting}
                    style={{ marginTop: "1.5rem" }}
                  >
                    CHOOSE ANOTHER VIDEO
                  </button>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="upload-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>

      <section className="features-section" id="features">
        <div className="section-heading">
          <div className="eyebrow">BUILT FOR YOUR FLOW</div>
          <h2>LESS SCROLLING. MORE CREATING.</h2>
        </div>

        <div className="feature-grid">
          <article className="feature-card">
            <div className="feature-icon">✂</div>
            <h3>AUTO SPLIT</h3>
            <p>
              Break long videos into short clips with your chosen duration.
            </p>
            <span className="feature-number">01 / CUT</span>
          </article>

          <article className="feature-card">
            <div className="feature-icon">◷</div>
            <h3>PRECISION CUT</h3>
            <p>
              Choose exact start and end times. Keep only the moments you want.
            </p>
            <span className="feature-number">02 / TRIM</span>
          </article>

          <article className="feature-card">
            <div className="feature-icon">▣</div>
            <h3>SOCIAL READY</h3>
            <p>
              Prepare clips in vertical, square, landscape, or original format.
            </p>
            <span className="feature-number">03 / CREATE</span>
          </article>
        </div>
      </section>

      <section className="steps-section" id="how-it-works">
        <div className="section-heading">
          <div className="eyebrow">THREE STEPS. THAT&apos;S IT.</div>
          <h2>FROM LONG TO LEGENDARY.</h2>
        </div>

        <div className="steps-grid">
          <div className="step-item">
            <span>01</span>
            <h3>UPLOAD</h3>
            <p>Choose the video you want to work with.</p>
          </div>

          <div className="step-item">
            <span>02</span>
            <h3>MAKE THE CUT</h3>
            <p>Pick a duration or set your own timestamps.</p>
          </div>

          <div className="step-item">
            <span>03</span>
            <h3>TAKE IT WITH YOU</h3>
            <p>Download your clips and share them anywhere.</p>
          </div>
        </div>
      </section>

      <footer className="footer">
        <a className="brand" href="#">
          <span className="brand-mark">C</span>
          CLIPFORGE<span className="brand-dot">.</span>
        </a>

        <p>MAKE EVERY SECOND COUNT.</p>
        <span>BUILT FOR CREATORS. © {new Date().getFullYear()}</span>
      </footer>
    </main>
  );
}
