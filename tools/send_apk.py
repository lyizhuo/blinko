#!/usr/bin/env python3
"""Build the Blinko Android APK and send it to a Telegram bot.

Adapted from ~/.agents/skills/build-and-send-apk/send_apk.py for this project:
Blinko is a Tauri app, so the APK has to be produced by the Tauri CLI (which
builds the frontend into `frontendDist` and runs Gradle) instead of a bare
`gradlew assembleDebug`.

Usage:
    python tools/send_apk.py [--no-build] [--debug] [--caption TEXT]

Config: tools/send_apk_config.json (gitignored)
    {"bot_token": "...", "chat_id": "...", "project_root": "/path/to/blinko"}
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("[setup] Installing requests...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests"])
    import requests

APK_DIRS = {
    "release": Path("app/src-tauri/gen/android/app/build/outputs/apk/universal/release"),
    "debug": Path("app/src-tauri/gen/android/app/build/outputs/apk/universal/debug"),
}

# Telegram bots reject documents above 50 MB, so the universal APK (4 ABIs, ~90 MB)
# cannot be sent. Per-ABI splits are used instead; arm64 covers essentially every
# device, armeabi-v7a the older 32-bit ones.
SPLIT_APK_DIRS = {
    "release": Path("app/src-tauri/gen/android/app/build/outputs/apk"),
    "debug": Path("app/src-tauri/gen/android/app/build/outputs/apk"),
}
TELEGRAM_MAX_BYTES = 50 * 1024 * 1024


def load_config(config_path: Path) -> dict:
    if not config_path.exists():
        sys.exit(f"[error] Config not found: {config_path}")
    with open(config_path) as f:
        cfg = json.load(f)
    missing = [k for k in ("bot_token", "chat_id", "project_root") if not cfg.get(k)]
    if missing:
        sys.exit(f"[error] Missing config values: {', '.join(missing)}")
    return cfg


def build_apk(project_root: Path, debug: bool, split_per_abi: bool) -> None:
    """Build the APK (frontend + Rust + Gradle) via the Tauri CLI."""
    app_dir = project_root / "app"
    if not app_dir.is_dir():
        sys.exit(f"[error] app/ not found in {project_root}")

    sdk = os.environ.get("ANDROID_HOME") or str(Path.home() / "Android" / "Sdk")
    java_home = os.environ.get("JAVA_HOME") or str(
        Path.home() / ".sdkman" / "candidates" / "java" / "17.0.19-tem"
    )
    env = {
        **os.environ,
        "JAVA_HOME": java_home,
        "ANDROID_HOME": sdk,
        "ANDROID_SDK_ROOT": sdk,
        "NDK_HOME": os.environ.get("NDK_HOME") or str(Path(sdk) / "ndk" / "28.2.13676358"),
        "PATH": f"{java_home}/bin:{sdk}/platform-tools:{os.environ.get('PATH', '')}",
    }

    args = ["bun", "tauri", "android", "build", "--apk"]
    if debug:
        args.append("--debug")
    if split_per_abi:
        args.append("--split-per-abi")

    print(f"[build] {' '.join(args)} (cwd={app_dir})")
    result = subprocess.run(args, cwd=str(app_dir), capture_output=True, text=True, env=env)
    if result.returncode != 0:
        print(f"[error] Build failed (exit {result.returncode})")
        print(result.stdout[-4000:] if result.stdout else "")
        print(result.stderr[-4000:] if result.stderr else "")
        sys.exit(1)
    print("[build] Build finished")


def find_apk(project_root: Path, debug: bool, split_per_abi: bool, abi: str) -> Path:
    mode = "debug" if debug else "release"
    if split_per_abi:
        apk_dir = project_root / SPLIT_APK_DIRS[mode] / abi / mode
    else:
        apk_dir = project_root / APK_DIRS[mode]
    apks = sorted(apk_dir.glob("*.apk"))
    if not apks:
        sys.exit(f"[error] No APK found in {apk_dir}")
    apk_path = apks[0]
    size_mb = apk_path.stat().st_size / (1024 * 1024)
    print(f"[build] APK: {apk_path.name} ({size_mb:.1f} MB)")
    if apk_path.stat().st_size > TELEGRAM_MAX_BYTES:
        sys.exit(
            f"[error] {apk_path.name} is larger than Telegram's 50 MB bot upload limit; "
            "build with --split-per-abi and pass --abi"
        )
    return apk_path


def get_git_changelog(project_root: Path, max_entries: int = 10) -> str:
    """Commit subjects since the last build tag (or the last 10 commits)."""
    try:
        tag_result = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=0", "--match", "build-*"],
            cwd=str(project_root), capture_output=True, text=True,
        )
        last_tag = tag_result.stdout.strip() if tag_result.returncode == 0 else ""
        log_range = f"{last_tag}..HEAD" if last_tag else "-10"
        log_result = subprocess.run(
            ["git", "log", log_range, "--pretty=format:%s", "--no-merges"],
            cwd=str(project_root), capture_output=True, text=True,
        )
        commits = [line.strip() for line in log_result.stdout.strip().split("\n") if line.strip()]
        if not commits:
            return ""
        lines = [f"  {i}. {c}" for i, c in enumerate(commits[:max_entries], 1)]
        header = f"Changes since {last_tag}:" if last_tag else f"Recent changes (last {len(lines)} commits):"
        return f"{header}\n" + "\n".join(lines)
    except Exception as e:
        return f"(changelog unavailable: {e})"


def get_diff_stats(project_root: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "diff", "--stat"], cwd=str(project_root), capture_output=True, text=True
        )
        if result.stdout.strip():
            summary = result.stdout.strip().split("\n")[-1]
            return f"Uncommitted changes: {summary}"
    except Exception:
        pass
    return ""


def send_to_telegram(apk_path: Path, bot_token: str, chat_id: str, caption: str) -> None:
    url = f"https://api.telegram.org/bot{bot_token}/sendDocument"
    print("[send] Uploading to Telegram...")
    with open(apk_path, "rb") as f:
        resp = requests.post(
            url,
            data={"chat_id": chat_id, "caption": caption},
            files={"document": (apk_path.name, f, "application/vnd.android.package-archive")},
            timeout=300,
        )
    if resp.status_code == 200:
        print("[send] APK sent successfully!")
    else:
        print(f"[error] Telegram API returned {resp.status_code}: {resp.text}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Build Blinko APK and send to Telegram")
    parser.add_argument("--config", type=Path,
                        default=Path(__file__).parent / "send_apk_config.json")
    parser.add_argument("--project-root", type=Path, default=None)
    parser.add_argument("--no-build", action="store_true", help="Send the existing APK")
    parser.add_argument("--debug", action="store_true", help="Build/send the debug APK")
    parser.add_argument("--split-per-abi", action="store_true", help="Build per-ABI split APKs")
    parser.add_argument(
        "--abi",
        default="arm64",
        help="Split directory to send: arm64 | arm | x86 | x86_64 (default: arm64)",
    )
    parser.add_argument("--caption", type=str, default=None)
    args = parser.parse_args()

    cfg = load_config(args.config)
    project_root = args.project_root or Path(cfg["project_root"])

    if not args.no_build:
        build_apk(project_root, args.debug, args.split_per_abi)
    apk_path = find_apk(project_root, args.debug, args.split_per_abi, args.abi)

    if args.caption:
        caption = args.caption
    else:
        parts = [f"Blinko Android ({'debug' if args.debug else 'release'})\nAPK: {apk_path.name}"]
        changelog = get_git_changelog(project_root)
        if changelog:
            parts.append(changelog)
        diff_stats = get_diff_stats(project_root)
        if diff_stats:
            parts.append(diff_stats)
        caption = "\n\n".join(parts)

    send_to_telegram(apk_path, cfg["bot_token"], cfg["chat_id"], caption)


if __name__ == "__main__":
    main()
