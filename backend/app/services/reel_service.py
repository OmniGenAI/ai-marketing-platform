"""
Reel generation service.
Uses Edge TTS for voiceover. Video sources (in priority order):
  1. Google Gemini Veo 3 with native audio (requires GOOGLE_GEMINI_API_KEY)
  2. fal.ai / Pika silent video + Edge TTS voiceover (requires FAL_API_KEY)
  3. Pexels stock videos + Edge TTS voiceover (fallback, requires PEXELS_API_KEY)
"""
import asyncio
import httpx
import json
import os
import tempfile
import time
import uuid
from typing import Optional

from app.config import settings

# Lazy import edge_tts to prevent crashes if not available
_edge_tts = None

def _get_edge_tts():
    global _edge_tts
    if _edge_tts is None:
        try:
            import edge_tts
            _edge_tts = edge_tts
        except ImportError as e:
            raise ImportError(f"edge_tts is required for voiceover generation: {e}")
    return _edge_tts


async def generate_ai_video_gemini(
    prompt: str,
    output_path: str,
    duration: int = 8,
    aspect_ratio: str = "9:16",
    model: str = "veo-3.0-generate-001",
    generate_audio: bool = True,
) -> bool:
    """
    Generate AI video using Google Gemini Veo model.
    Saves the video directly to output_path.
    Returns True on success, False on failure.
    """
    if not settings.GOOGLE_GEMINI_API_KEY:
        return False

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.GOOGLE_GEMINI_API_KEY)
        # Veo 3 supports 6-8 second clips (API rejects values below 6)
        clip_duration = 8 if duration >= 8 else max(6, min(8, duration))

        def _run_generation() -> bytes | None:
            operation = client.models.generate_videos(
                model=model,
                prompt=prompt,
                config=types.GenerateVideosConfig(
                    aspect_ratio=aspect_ratio,
                    duration_seconds=clip_duration,
                    number_of_videos=1,
                ),
            )
            # Poll until complete (max 5 minutes)
            for _ in range(30):
                if operation.done:
                    break
                time.sleep(10)
                operation = client.operations.get(operation)

            if not operation.done:
                print("[Gemini Veo] Timed out waiting for video generation")
                return None

            generated = operation.response.generated_videos
            if not generated:
                print("[Gemini Veo] No videos in response")
                return None

            return client.files.download(file=generated[0].video)

        loop = asyncio.get_event_loop()
        video_bytes = await loop.run_in_executor(None, _run_generation)

        if not video_bytes:
            return False

        with open(output_path, "wb") as f:
            f.write(video_bytes)

        print(f"[Gemini Veo] Video saved to {output_path}")
        return True

    except Exception as e:
        print(f"[Gemini Veo] Error: {e}")
        return False


def split_script_into_sentences(script: str) -> list[str]:
    """
    Split a script into individual sentences for per-scene video generation.
    Filters out fragments that are too short to produce a meaningful visual.
    """
    import re
    sentences = re.split(r'(?<=[.!?])\s+', script.strip())
    return [s.strip() for s in sentences if len(s.strip()) > 15]


def build_scene_prompt(sentence: str, topic: str, tone: str) -> str:
    """Build a Veo 3 prompt for a single sentence/scene with native audio narration."""
    return (
        f"Cinematic, photorealistic vertical social media video scene. "
        f"The narrator speaks exactly these words: \"{sentence}\" "
        f"Visual context and overall topic: {topic}. "
        f"Atmosphere and mood: {tone}. "
        f"High quality, smooth dynamic camera motion, professional lighting, highly detailed. "
        f"No text overlays, no subtitles, no watermarks, perfectly clear audio."
    )


async def generate_multi_scene_video_gemini(
    sentences: list[str],
    topic: str,
    tone: str,
    temp_dir: str,
    output_path: str,
    generate_audio: bool = True,
) -> bool:
    """
    Generate one Veo 3 clip per sentence, then concatenate them into a single video.
    Clips are generated with limited concurrency (2 at a time) to avoid rate limits.
    Returns True on success, False on failure.
    """
    if not settings.GOOGLE_GEMINI_API_KEY or not sentences:
        return False

    semaphore = asyncio.Semaphore(2)

    async def _generate_scene(i: int, sentence: str) -> str | None:
        async with semaphore:
            clip_path = os.path.join(temp_dir, f"scene_{i:02d}.mp4")
            prompt = build_scene_prompt(sentence, topic, tone)
            print(f"[Gemini Veo] Scene {i + 1}/{len(sentences)}: {sentence[:70]}...")
            success = await generate_ai_video_gemini(
                prompt=prompt,
                output_path=clip_path,
                duration=6,
                aspect_ratio="9:16",
                generate_audio=generate_audio,
            )
            return clip_path if success else None

    tasks = [_generate_scene(i, s) for i, s in enumerate(sentences)]
    clip_paths = [p for p in await asyncio.gather(*tasks) if p is not None]

    if not clip_paths:
        print("[Gemini Veo] No scenes generated successfully")
        return False

    if len(clip_paths) == 1:
        import shutil
        shutil.copy(clip_paths[0], output_path)
        print(f"[Gemini Veo] Single scene saved to {output_path}")
        return True

    def _concatenate(paths: list[str], out: str) -> None:
        from moviepy import VideoFileClip, concatenate_videoclips
        clips = [VideoFileClip(p) for p in paths]
        final = concatenate_videoclips(clips, method="compose")
        final.write_videofile(
            out,
            fps=30,
            codec="libx264",
            audio_codec="aac",
            preset="fast",
            threads=4,
            logger=None,
            ffmpeg_params=[
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                "-profile:v", "baseline",
                "-level", "3.0",
                "-crf", "23",
            ],
        )
        for c in clips:
            c.close()
        final.close()

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _concatenate, clip_paths, output_path)
    print(f"[Gemini Veo] {len(clip_paths)} scenes concatenated -> {output_path}")
    return True


async def generate_ai_video_fal(
    prompt: str,
    duration: int = 5,
    aspect_ratio: str = "9:16",
) -> str | None:
    """
    Generate AI video using fal.ai's Pika API.
    Returns the video URL or None if failed.
    """
    if not settings.FAL_API_KEY:
        return None

    try:
        # Submit the video generation request
        async with httpx.AsyncClient(timeout=120.0) as client:
            # Start the generation
            response = await client.post(
                "https://queue.fal.run/fal-ai/pika/v2/text-to-video",
                headers={
                    "Authorization": f"Key {settings.FAL_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "prompt": prompt,
                    "aspect_ratio": aspect_ratio,
                    "duration": min(duration, 5),  # Pika max 5 seconds per clip
                },
            )
            response.raise_for_status()
            result = response.json()

            # Get the request ID for polling
            request_id = result.get("request_id")
            if not request_id:
                print(f"[fal.ai] No request_id in response: {result}")
                return None

            # Poll for completion
            status_url = f"https://queue.fal.run/fal-ai/pika/v2/text-to-video/requests/{request_id}/status"

            for _ in range(60):  # Max 60 attempts (2 minutes)
                await asyncio.sleep(2)

                status_response = await client.get(
                    status_url,
                    headers={"Authorization": f"Key {settings.FAL_API_KEY}"},
                )
                status_data = status_response.json()
                status = status_data.get("status")

                if status == "COMPLETED":
                    # Get the result
                    result_url = f"https://queue.fal.run/fal-ai/pika/v2/text-to-video/requests/{request_id}"
                    result_response = await client.get(
                        result_url,
                        headers={"Authorization": f"Key {settings.FAL_API_KEY}"},
                    )
                    result_data = result_response.json()
                    video_url = result_data.get("video", {}).get("url")
                    if video_url:
                        print(f"[fal.ai] Video generated: {video_url}")
                        return video_url
                    break

                elif status == "FAILED":
                    error = status_data.get("error", "Unknown error")
                    print(f"[fal.ai] Generation failed: {error}")
                    return None

            print("[fal.ai] Generation timed out")
            return None

    except Exception as e:
        print(f"[fal.ai] Error: {e}")
        return None


# Available TTS voices
AVAILABLE_VOICES = [
    {
        "id": "en-US-JennyNeural",
        "name": "Jenny",
        "gender": "female",
        "language": "English (US)",
        "description": "Natural, conversational female voice",
    },
    {
        "id": "en-US-GuyNeural",
        "name": "Guy",
        "gender": "male",
        "language": "English (US)",
        "description": "Professional male voice",
    },
    {
        "id": "en-US-AriaNeural",
        "name": "Aria",
        "gender": "female",
        "language": "English (US)",
        "description": "Warm, friendly female voice",
    },
    {
        "id": "en-US-DavisNeural",
        "name": "Davis",
        "gender": "male",
        "language": "English (US)",
        "description": "Clear, confident male voice",
    },
    {
        "id": "en-GB-SoniaNeural",
        "name": "Sonia",
        "gender": "female",
        "language": "English (UK)",
        "description": "British female voice",
    },
    {
        "id": "en-GB-RyanNeural",
        "name": "Ryan",
        "gender": "male",
        "language": "English (UK)",
        "description": "British male voice",
    },
]


def get_available_voices() -> list[dict]:
    """Return list of available TTS voices."""
    return AVAILABLE_VOICES


def generate_reel_script(
    topic: str,
    tone: str,
    duration_target: int,
    business_name: str = "",
    niche: str = "",
) -> dict:
    """
    Generate a short script for the reel using Grok AI (xAI) or fallback to Gemini.
    Returns script text and hashtags.
    """
    # Estimate word count based on speaking rate (~150 words/minute)
    word_count = int((duration_target / 60) * 130)  # Slightly slower for clarity

    prompt = f"""You are a social media content expert. Generate a short, engaging script for an Instagram Reel.

Topic: {topic}
Tone: {tone}
Target Duration: {duration_target} seconds (approximately {word_count} words)
{"Business: " + business_name if business_name else ""}
{"Niche: " + niche if niche else ""}

Requirements:
- Write ONLY the spoken script, no stage directions or [brackets]
- Keep it punchy and engaging for social media
- Start with a hook to grab attention
- End with a call-to-action or memorable closing
- Aim for {word_count} words

Also generate 5-10 relevant hashtags.

Respond in this exact format:
SCRIPT:
[Your script here - no directions, just spoken words]

HASHTAGS:
[Your hashtags here]
"""

    # Try Groq first (fastest, free tier available)
    if settings.GROQ_API_KEY:
        try:
            response = httpx.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": "You are a social media content expert."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.7,
                },
                timeout=30.0
            )
            response.raise_for_status()
            result = response.json()
            text = result["choices"][0]["message"]["content"]

            return _parse_script_response(text)

        except Exception as e:
            print(f"Groq failed, trying next provider: {e}")

    # Try Grok AI (xAI)
    if settings.XAI_API_KEY:
        try:
            response = httpx.post(
                "https://api.x.ai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.XAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "grok-3-latest",
                    "messages": [
                        {"role": "system", "content": "You are a social media content expert."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.7,
                },
                timeout=30.0
            )
            response.raise_for_status()
            result = response.json()
            text = result["choices"][0]["message"]["content"]

            return _parse_script_response(text)

        except Exception as e:
            print(f"Grok AI failed, falling back to Gemini: {e}")

    # Fallback to Google Gemini
    if settings.GOOGLE_GEMINI_API_KEY:
        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key={settings.GOOGLE_GEMINI_API_KEY}"

        payload = {
            "contents": [{"parts": [{"text": prompt}]}]
        }

        try:
            response = httpx.post(api_url, json=payload, timeout=30.0)
            response.raise_for_status()
            result = response.json()
            text = result["candidates"][0]["content"]["parts"][0]["text"]

            return _parse_script_response(text)

        except Exception as e:
            raise Exception(f"Failed to generate script with Gemini: {str(e)}")

    raise Exception("No AI API key configured. Set XAI_API_KEY or GOOGLE_GEMINI_API_KEY.")


def _parse_script_response(text: str) -> dict:
    """Parse the AI response to extract script and hashtags."""
    script = ""
    hashtags = ""

    if "SCRIPT:" in text and "HASHTAGS:" in text:
        parts = text.split("HASHTAGS:")
        script = parts[0].replace("SCRIPT:", "").strip()
        hashtags = parts[1].strip()
    else:
        script = text.strip()

    return {"script": script, "hashtags": hashtags}


async def add_audio_to_video(video_path: str, audio_path: str, output_path: str) -> str:
    """
    Add audio track to a video file.
    Used for combining AI-generated video with voiceover.
    """
    try:
        from moviepy import VideoFileClip, AudioFileClip, concatenate_videoclips
        MOVIEPY_V2 = True
    except ImportError:
        from moviepy.editor import VideoFileClip, AudioFileClip, concatenate_videoclips
        MOVIEPY_V2 = False

    video = VideoFileClip(video_path)
    audio = AudioFileClip(audio_path)

    # If audio is longer than video, loop the video
    if audio.duration > video.duration:
        loops_needed = int(audio.duration / video.duration) + 1
        video = concatenate_videoclips([video] * loops_needed, method="compose")

    # Trim video to audio length
    if MOVIEPY_V2:
        video = video.subclipped(0, min(audio.duration + 0.5, video.duration))
        video = video.with_audio(audio)
    else:
        video = video.subclip(0, min(audio.duration + 0.5, video.duration))
        video = video.set_audio(audio)

    # Write output
    video.write_videofile(
        output_path,
        fps=30,
        codec="libx264",
        audio_codec="aac",
        preset="fast",
        threads=4,
        logger=None,
        ffmpeg_params=[
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-profile:v", "baseline",
            "-level", "3.0",
            "-crf", "23",
        ],
    )

    video.close()
    audio.close()

    return output_path


async def generate_voiceover(script: str, voice: str, output_path: str) -> str:
    """
    Generate voiceover audio using Edge TTS.
    Returns the path to the generated audio file.
    """
    edge_tts = _get_edge_tts()
    communicate = edge_tts.Communicate(script, voice)
    await communicate.save(output_path)
    return output_path


async def fetch_pexels_videos(
    query: str,
    count: int = 3,
    orientation: str = "portrait"
) -> list[dict]:
    """
    Fetch stock videos from Pexels API.
    Returns list of video info with download URLs.
    Uses SD quality for faster downloads.
    """
    if not settings.PEXELS_API_KEY:
        raise ValueError("PEXELS_API_KEY is not configured")

    url = "https://api.pexels.com/videos/search"
    headers = {"Authorization": settings.PEXELS_API_KEY}
    params = {
        "query": query,
        "per_page": count,
        "orientation": orientation,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url, headers=headers, params=params)
        response.raise_for_status()
        data = response.json()

    videos = []
    for video in data.get("videos", []):
        video_files = video.get("video_files", [])
        best_file = None

        # Prefer SD quality for faster downloads (still looks good on mobile)
        for vf in video_files:
            if vf.get("quality") == "sd" and vf.get("height", 0) >= 480:
                best_file = vf
                break

        # Fallback to smallest HD
        if not best_file:
            hd_files = [vf for vf in video_files if vf.get("quality") == "hd"]
            if hd_files:
                best_file = min(hd_files, key=lambda x: x.get("height", 9999))

        # Fallback to first available
        if not best_file and video_files:
            best_file = video_files[0]

        if best_file:
            videos.append({
                "id": video.get("id"),
                "url": best_file.get("link"),
                "width": best_file.get("width"),
                "height": best_file.get("height"),
                "duration": video.get("duration"),
            })

    return videos


async def download_video(url: str, output_path: str) -> str:
    """Download video from URL to local path using streaming."""
    print(f"[download_video] Downloading: {url[:100]}...")
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            total_size = 0
            with open(output_path, "wb") as f:
                async for chunk in response.aiter_bytes(chunk_size=8192):
                    f.write(chunk)
                    total_size += len(chunk)
    print(f"[download_video] Downloaded {total_size} bytes to {output_path}")
    return output_path


def compose_reel(
    video_paths: list[str],
    audio_path: str,
    output_path: str,
    target_duration: int,
    target_width: int = 1080,
    target_height: int = 1920,
) -> str:
    """
    Compose final reel video by combining stock videos with voiceover audio.
    Returns path to the final video.
    """
    # Import moviepy here to avoid startup issues if ffmpeg is missing
    try:
        from moviepy import VideoFileClip, AudioFileClip, concatenate_videoclips
        MOVIEPY_V2 = True
    except ImportError:
        from moviepy.editor import VideoFileClip, AudioFileClip, concatenate_videoclips
        MOVIEPY_V2 = False

    # Helper functions for v1/v2 compatibility
    def crop_clip(clip, x1=None, y1=None, x2=None, y2=None):
        if MOVIEPY_V2:
            return clip.cropped(x1=x1, y1=y1, x2=x2, y2=y2)
        else:
            return clip.crop(x1=x1, y1=y1, x2=x2, y2=y2)

    def resize_clip(clip, size):
        if MOVIEPY_V2:
            return clip.resized(size)
        else:
            # moviepy v1 uses resize with newsize parameter
            return clip.resize(newsize=size)

    def subclip_video(clip, start, end):
        if MOVIEPY_V2:
            return clip.subclipped(start, end)
        else:
            return clip.subclip(start, end)

    # Load audio to get actual duration
    audio = AudioFileClip(audio_path)
    audio_duration = audio.duration

    # Load and process video clips
    clips = []
    total_duration = 0

    for video_path in video_paths:
        try:
            print(f"[compose_reel] Loading video: {video_path}")
            clip = VideoFileClip(video_path)
            print(f"[compose_reel] Loaded clip: {clip.w}x{clip.h}, duration={clip.duration}")

            # Simple resize without complex cropping for better compatibility
            try:
                clip = resize_clip(clip, (target_width, target_height))
                print(f"[compose_reel] Resized to {target_width}x{target_height}")
            except Exception as resize_err:
                print(f"[compose_reel] Resize failed, using original: {resize_err}")
                # Use original clip without resizing if resize fails

            clips.append(clip)
            total_duration += clip.duration
            print(f"[compose_reel] Added clip, total duration: {total_duration}")

            # Stop if we have enough footage
            if total_duration >= audio_duration + 2:  # 2 second buffer
                break

        except Exception as e:
            print(f"[compose_reel] Error processing video {video_path}: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()
            continue

    if not clips:
        print(f"[compose_reel] FAILED - no clips loaded from {len(video_paths)} video paths")
        raise Exception(f"No valid video clips to compose. Tried {len(video_paths)} videos.")

    # Concatenate all clips
    video = concatenate_videoclips(clips, method="compose")

    # Trim or loop to match audio duration
    if video.duration < audio_duration:
        # Loop the video if it's shorter than audio
        loops_needed = int(audio_duration / video.duration) + 1
        video = concatenate_videoclips([video] * loops_needed, method="compose")

    # Trim to audio duration (plus small fade out buffer)
    video = subclip_video(video, 0, min(audio_duration + 0.5, video.duration))

    # Add audio (v1: set_audio, v2: with_audio)
    if MOVIEPY_V2:
        video = video.with_audio(audio)
    else:
        video = video.set_audio(audio)

    # Write final video with Instagram-compatible settings
    video.write_videofile(
        output_path,
        fps=30,
        codec="libx264",
        audio_codec="aac",
        preset="fast",
        threads=4,
        logger=None,
        ffmpeg_params=[
            "-pix_fmt", "yuv420p",  # Required for Instagram compatibility
            "-movflags", "+faststart",  # Optimize for web streaming
            "-profile:v", "baseline",  # Maximum compatibility
            "-level", "3.0",
            "-crf", "23",  # Good quality
        ],
    )

    # Clean up
    audio.close()
    for clip in clips:
        clip.close()
    video.close()

    return output_path


async def upload_reel_to_supabase(
    file_path: str,
    user_id: str,
    file_type: str = "video",
) -> str:
    """
    Upload reel video or audio to Supabase storage.
    Returns the public URL.
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise ValueError("Supabase is not configured")

    bucket_name = "uploads"

    # Generate unique filename
    ext = "mp4" if file_type == "video" else "mp3"
    content_type = "video/mp4" if file_type == "video" else "audio/mpeg"
    if file_type == "image":
        ext = "jpg"
        content_type = "image/jpeg"

    filename = f"reels/{user_id}/{uuid.uuid4()}.{ext}"

    # Read file content
    with open(file_path, "rb") as f:
        file_content = f.read()

    async with httpx.AsyncClient(timeout=300.0) as client:
        # First, ensure bucket exists
        bucket_url = f"{settings.SUPABASE_URL}/storage/v1/bucket/{bucket_name}"
        headers_json = {
            "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        # Check if bucket exists
        check_response = await client.get(bucket_url, headers=headers_json)

        if check_response.status_code == 404:
            # Create bucket
            create_url = f"{settings.SUPABASE_URL}/storage/v1/bucket"
            create_response = await client.post(
                create_url,
                headers=headers_json,
                json={
                    "name": bucket_name,
                    "public": True,
                    "file_size_limit": 52428800,  # 50MB
                }
            )
            if create_response.status_code not in [200, 201]:
                print(f"Warning: Could not create bucket: {create_response.text}")

        # Upload file
        storage_url = f"{settings.SUPABASE_URL}/storage/v1/object/{bucket_name}/{filename}"
        headers = {
            "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": content_type,
        }

        response = await client.post(storage_url, headers=headers, content=file_content)

        if response.status_code not in [200, 201]:
            # Try PUT for upsert
            response = await client.put(storage_url, headers=headers, content=file_content)

        if response.status_code not in [200, 201]:
            raise Exception(f"Failed to upload to Supabase: {response.status_code} - {response.text}")

    # Return public URL
    public_url = f"{settings.SUPABASE_URL}/storage/v1/object/public/{bucket_name}/{filename}"
    return public_url


async def generate_thumbnail(video_path: str, output_path: str, time: float = 1.0) -> str:
    """
    Generate a thumbnail from the video at specified time.
    Returns path to thumbnail image.
    """
    # Import moviepy here to avoid startup issues if ffmpeg is missing
    try:
        from moviepy import VideoFileClip
    except ImportError:
        from moviepy.editor import VideoFileClip

    clip = VideoFileClip(video_path)
    # Get frame at specified time (or middle if time exceeds duration)
    t = min(time, clip.duration / 2)
    frame = clip.get_frame(t)

    # Save as JPEG using PIL
    from PIL import Image
    import numpy as np

    img = Image.fromarray(np.uint8(frame))
    img.save(output_path, "JPEG", quality=85)
    clip.close()

    return output_path


async def process_reel_generation(
    reel_id: str,
    topic: str,
    tone: str,
    voice: str,
    duration_target: int,
    user_id: str,
    business_name: str = "",
    niche: str = "",
    db_session=None,
) -> dict:
    """
    Full reel generation pipeline. Run this as a background task.
    Returns dict with script, hashtags, audio_url, video_url, thumbnail_url.
    """
    from app.models.reel import Reel

    temp_dir = tempfile.mkdtemp()
    result = {}

    try:
        # Update status to processing
        if db_session:
            reel = db_session.query(Reel).filter(Reel.id == reel_id).first()
            if reel:
                reel.status = "generating_script"
                db_session.commit()

        # Step 1: Generate script
        print(f"[Reel {reel_id}] Generating script...")
        script_result = generate_reel_script(
            topic=topic,
            tone=tone,
            duration_target=duration_target,
            business_name=business_name,
            niche=niche,
        )
        result["script"] = script_result["script"]
        result["hashtags"] = script_result["hashtags"]

        if db_session:
            reel = db_session.query(Reel).filter(Reel.id == reel_id).first()
            if reel:
                reel.script = result["script"]
                reel.hashtags = result["hashtags"]
                reel.status = "generating_audio"
                db_session.commit()

        # Step 2: Generate voiceover (only needed if Gemini native audio won't be used)
        # We pre-check: if GOOGLE_GEMINI_API_KEY is set we'll use Veo 3 native audio,
        # so skip Edge TTS generation entirely in that case.
        audio_path = os.path.join(temp_dir, "voiceover.mp3")
        audio_url = None
        if not settings.GOOGLE_GEMINI_API_KEY:
            print(f"[Reel {reel_id}] Generating voiceover...")
            await generate_voiceover(result["script"], voice, audio_path)
            audio_url = await upload_reel_to_supabase(audio_path, user_id, "audio")
            result["audio_url"] = audio_url

        if db_session:
            reel = db_session.query(Reel).filter(Reel.id == reel_id).first()
            if reel:
                reel.audio_url = audio_url
                reel.status = "fetching_videos"
                db_session.commit()

        # Step 3: Generate or fetch videos
        use_ai_video = False
        ai_video_path = os.path.join(temp_dir, "ai_video.mp4")
        videos = []

        # Visual prompt derived from the actual script so the video matches the narration
        script_preview = result["script"][:300].strip()
        video_prompt = (
            f"Cinematic vertical social media reel video that visually depicts: {script_preview}. "
            f"Topic: {topic}. Tone: {tone}. "
            f"Smooth motion, engaging visuals, no text overlays, no subtitles."
        )

        # --- Option 1: Gemini Veo 3 — per-sentence multi-scene with native audio ---
        native_audio_embedded = False
        if settings.GOOGLE_GEMINI_API_KEY:
            print(f"[Reel {reel_id}] Generating per-scene AI video with Gemini Veo 3 (native audio)...")
            if db_session:
                reel = db_session.query(Reel).filter(Reel.id == reel_id).first()
                if reel:
                    reel.status = "generating_ai_video"
                    db_session.commit()

            sentences = split_script_into_sentences(result["script"])
            print(f"[Reel {reel_id}] Script split into {len(sentences)} scene(s)")

            success = await generate_multi_scene_video_gemini(
                sentences=sentences,
                topic=topic,
                tone=tone,
                temp_dir=temp_dir,
                output_path=ai_video_path,
                generate_audio=False,
            )
            if success:
                use_ai_video = True
                native_audio_embedded = True
                print(f"[Reel {reel_id}] Gemini Veo 3 multi-scene video with native audio generated successfully!")

        # --- Option 2: fal.ai / Pika (secondary AI generator) ---
        if not use_ai_video and settings.FAL_API_KEY:
            print(f"[Reel {reel_id}] Generating AI video with fal.ai/Pika...")
            if db_session:
                reel = db_session.query(Reel).filter(Reel.id == reel_id).first()
                if reel:
                    reel.status = "generating_ai_video"
                    db_session.commit()

            ai_video_url = await generate_ai_video_fal(
                prompt=video_prompt,
                duration=min(duration_target, 5),
                aspect_ratio="9:16",
            )
            if ai_video_url:
                print(f"[Reel {reel_id}] fal.ai video generated, downloading...")
                await download_video(ai_video_url, ai_video_path)
                use_ai_video = True
                print(f"[Reel {reel_id}] fal.ai video ready!")

        # --- Option 3: Pexels stock videos (fallback) ---
        if not use_ai_video:
            print(f"[Reel {reel_id}] Fetching stock videos from Pexels...")
            if db_session:
                reel = db_session.query(Reel).filter(Reel.id == reel_id).first()
                if reel:
                    reel.status = "fetching_videos"
                    db_session.commit()

            search_query = " ".join(topic.split()[:3])
            videos = await fetch_pexels_videos(search_query, count=5)
            if not videos:
                videos = await fetch_pexels_videos(topic.split()[0], count=5)
            if not videos:
                raise Exception("Could not find suitable stock videos")

        if db_session:
            reel = db_session.query(Reel).filter(Reel.id == reel_id).first()
            if reel:
                reel.status = "downloading_videos" if not use_ai_video else "processing_video"
                db_session.commit()

        # Step 4 & 5: Process video based on source
        output_path = os.path.join(temp_dir, "final_reel.mp4")

        if use_ai_video:
            if native_audio_embedded:
                # Re-encode Veo 3 output to compress and ensure Instagram compatibility
                print(f"[Reel {reel_id}] Re-encoding Veo 3 video for upload...")

                def _reencode(src: str, dst: str) -> None:
                    from moviepy import VideoFileClip
                    clip = VideoFileClip(src)
                    clip.write_videofile(
                        dst,
                        fps=30,
                        codec="libx264",
                        audio_codec="aac",
                        preset="fast",
                        threads=4,
                        logger=None,
                        ffmpeg_params=[
                            "-pix_fmt", "yuv420p",
                            "-movflags", "+faststart",
                            "-profile:v", "baseline",
                            "-level", "3.0",
                            "-crf", "26",
                        ],
                    )
                    clip.close()

                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, _reencode, ai_video_path, output_path)
            else:
                # fal.ai silent video — mix in Edge TTS voiceover
                print(f"[Reel {reel_id}] Adding Edge TTS voiceover to AI video...")
                await add_audio_to_video(ai_video_path, audio_path, output_path)

        else:
            # Traditional flow: download stock videos and compose
            print(f"[Reel {reel_id}] Downloading {len(videos[:3])} videos in parallel...")

            async def download_with_path(i: int, video: dict) -> str | None:
                video_path = os.path.join(temp_dir, f"clip_{i}.mp4")
                try:
                    await download_video(video["url"], video_path)
                    return video_path
                except Exception as e:
                    print(f"Failed to download video {i}: {e}")
                    return None

            # Download all videos concurrently
            download_tasks = [download_with_path(i, v) for i, v in enumerate(videos[:3])]
            results = await asyncio.gather(*download_tasks)
            video_paths = [p for p in results if p is not None]

            if not video_paths:
                raise Exception("Could not download any videos")

            if db_session:
                reel = db_session.query(Reel).filter(Reel.id == reel_id).first()
                if reel:
                    reel.status = "composing_video"
                    db_session.commit()

            # Compose final video
            print(f"[Reel {reel_id}] Composing final video...")
            compose_reel(
                video_paths=video_paths,
                audio_path=audio_path,
                output_path=output_path,
                target_duration=duration_target,
            )

        # Upload final video
        video_url = await upload_reel_to_supabase(output_path, user_id, "video")
        result["video_url"] = video_url

        # Step 6: Generate and upload thumbnail
        print(f"[Reel {reel_id}] Generating thumbnail...")
        thumbnail_path = os.path.join(temp_dir, "thumbnail.jpg")
        await generate_thumbnail(output_path, thumbnail_path)
        thumbnail_url = await upload_reel_to_supabase(thumbnail_path, user_id, "image")
        result["thumbnail_url"] = thumbnail_url

        # Update final status
        if db_session:
            reel = db_session.query(Reel).filter(Reel.id == reel_id).first()
            if reel:
                reel.video_url = video_url
                reel.thumbnail_url = thumbnail_url
                reel.status = "ready"
                db_session.commit()

        print(f"[Reel {reel_id}] Generation complete!")
        return result

    except Exception as e:
        print(f"[Reel {reel_id}] Error: {str(e)}")
        if db_session:
            reel = db_session.query(Reel).filter(Reel.id == reel_id).first()
            if reel:
                reel.status = "failed"
                reel.error_message = str(e)
                db_session.commit()
        raise

    finally:
        # Cleanup temp files
        import shutil
        try:
            shutil.rmtree(temp_dir)
        except:
            pass
