#!/usr/bin/env python3
import sys
import json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No video file specified"}))
        sys.exit(1)

    video_file = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "tiny"
    models_dir = sys.argv[3] if len(sys.argv) > 3 else None

    try:
        from faster_whisper import WhisperModel

        kwargs = {"device": "cpu", "compute_type": "int8"}
        if models_dir:
            kwargs["download_root"] = models_dir

        model = WhisperModel(model_name, **kwargs)
        segments_iter, info = model.transcribe(video_file, beam_size=5)

        result = {"text": "", "segments": [], "language": info.language}
        for seg in segments_iter:
            text = seg.text.strip()
            if not text:
                continue
            result["segments"].append({
                "start": round(seg.start, 2),
                "end": round(seg.end, 2),
                "text": text,
            })
            result["text"] += (" " if result["text"] else "") + text

        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
