"""VRM-safe optimizer (texture-only) — can target ~5MB.

Edits only embedded image bytes inside the VRM (GLB) to reduce size while
preserving VRM extensions. Designed to run locally (no Colab).

Example:
    python vrm_optimizer.py public/three-avatar/avatars/adam.vrm --target-mb 5
"""

from __future__ import annotations

import argparse
import io
import os
from pathlib import Path

from PIL import Image
from pygltflib import GLTF2

def pad4(data: bytes) -> bytes:
    return data + b"\x00" * ((4 - (len(data) % 4)) % 4)

def is_vrm(gltf: GLTF2) -> bool:
    used = getattr(gltf, "extensionsUsed", None) or []
    ext = getattr(gltf, "extensions", None) or {}
    return ("VRM" in used) or ("VRMC_vrm" in used) or ("VRM" in ext) or ("VRMC_vrm" in ext)

def get_normal_texture_image_indices(gltf: GLTF2):
    normal_tex_indices = set()
    if not gltf.materials:
        return set()
    for m in gltf.materials:
        nt = getattr(m, "normalTexture", None)
        if nt and getattr(nt, "index", None) is not None:
            normal_tex_indices.add(nt.index)

    image_indices = set()
    if gltf.textures:
        for t_idx in normal_tex_indices:
            if t_idx < len(gltf.textures):
                tex = gltf.textures[t_idx]
                if getattr(tex, "source", None) is not None:
                    image_indices.add(tex.source)
    return image_indices

def rebuild_blob_with_replacements(gltf: GLTF2, original_blob: bytes, replacements: dict):
    bvs = gltf.bufferViews
    if not bvs:
        raise RuntimeError("No bufferViews found.")

    order = sorted(range(len(bvs)), key=lambda i: (bvs[i].byteOffset or 0))

    new_blob = bytearray()
    cursor = 0

    for i in order:
        bv = bvs[i]
        off = bv.byteOffset or 0
        ln = bv.byteLength or 0

        if off > cursor:
            new_blob += original_blob[cursor:off]
            cursor = off

        if i in replacements:
            data = replacements[i]
            data_padded = pad4(data)
            bv.byteOffset = len(new_blob)
            bv.byteLength = len(data)  # logical length (unpadded)
            new_blob += data_padded
        else:
            chunk = original_blob[off:off+ln]
            bv.byteOffset = len(new_blob)
            bv.byteLength = ln
            new_blob += pad4(chunk)

        cursor = off + ln

    if cursor < len(original_blob):
        new_blob += original_blob[cursor:]

    if not gltf.buffers:
        raise RuntimeError("No buffers found.")
    gltf.buffers[0].byteLength = len(new_blob)

    return bytes(new_blob)

def optimize_vrm_file(
    input_path: Path,
    output_path: Path,
    *,
    max_size: int,
    webp_quality: int,
    thumb_max: int,
    thumb_quality: int,
    normal_max: int,
    normal_quality: int,
) -> None:
    gltf = GLTF2().load_binary(str(input_path))
    blob = gltf.binary_blob()

    print(f"\n== {input_path.name} ==")
    print("VRM detected (before):", is_vrm(gltf))
    if not is_vrm(gltf):
        print("Warning: file does not look like VRM (continuing anyway).")

    normal_image_indices = get_normal_texture_image_indices(gltf)
    replacements: dict[int, bytes] = {}

    if not gltf.images:
        raise SystemExit("No images found in the model.")

    for img_index, img in enumerate(gltf.images):
        bv_index = getattr(img, "bufferView", None)
        if bv_index is None:
            continue

        bv = gltf.bufferViews[bv_index]
        off = bv.byteOffset or 0
        ln = bv.byteLength or 0
        raw = blob[off : off + ln]

        try:
            im = Image.open(io.BytesIO(raw))
            im.load()
        except Exception as e:
            print(f"Skipping image[{img_index}] (can't decode): {e}")
            continue

        name = (getattr(img, "name", "") or "").lower()
        is_thumb = "thumbnail" in name
        is_normal = img_index in normal_image_indices

        if is_thumb:
            limit = thumb_max
            quality = thumb_quality
        elif is_normal:
            limit = normal_max
            quality = normal_quality
        else:
            limit = max_size
            quality = webp_quality

        # Resize (keep aspect)
        w, h = im.size
        scale = min(1.0, limit / max(w, h))
        if scale < 1.0:
            nw = max(1, int(round(w * scale)))
            nh = max(1, int(round(h * scale)))
            im = im.resize((nw, nh), Image.LANCZOS)

        # Encode WebP
        out = io.BytesIO()
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGBA")
        im.save(out, format="WEBP", quality=quality, method=6)
        new_bytes = out.getvalue()

        replacements[bv_index] = new_bytes
        img.mimeType = "image/webp"

    print(f"Re-encoded {len(replacements)} embedded textures.")
    new_blob = rebuild_blob_with_replacements(gltf, blob, replacements)
    gltf.set_binary_blob(new_blob)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    gltf.save_binary(str(output_path))

    gltf2 = GLTF2().load_binary(str(output_path))
    print("VRM detected (after):", is_vrm(gltf2))
    print("Old size MB:", os.path.getsize(input_path) / (1024 * 1024))
    print("New size MB:", os.path.getsize(output_path) / (1024 * 1024))


def _candidate_settings_for_target(
    *,
    start_max_size: int,
    start_webp_quality: int,
    start_thumb_max: int,
    start_thumb_quality: int,
    start_normal_max: int,
    start_normal_quality: int,
):
    """Yield a small set of descending-quality settings.

    Strategy: prefer lowering resolution (max size) before crushing quality.
    All candidates are meant to be re-run from the original input (no stacking).
    """

    # Resolution steps (most impactful and usually least objectionable)
    size_steps = [
        start_max_size,
        448,
        384,
        320,
        256,
    ]
    size_steps = [s for s in size_steps if s <= start_max_size and s >= 128]
    # Ensure uniqueness while keeping order
    seen = set()
    size_steps = [s for s in size_steps if not (s in seen or seen.add(s))]

    # Quality steps (secondary)
    quality_steps = [
        start_webp_quality,
        min(65, start_webp_quality),
        60,
        55,
        50,
        45,
    ]
    quality_steps = [q for q in quality_steps if 10 <= q <= start_webp_quality]
    seen_q = set()
    quality_steps = [q for q in quality_steps if not (q in seen_q or seen_q.add(q))]

    # Try: for each resolution, walk down quality a bit.
    for s in size_steps:
        for q in quality_steps:
            thumb_max = min(start_thumb_max, max(256, s))
            thumb_quality = min(start_thumb_quality, max(30, q - 10))
            normal_max = min(start_normal_max, s)
            normal_quality = min(start_normal_quality, max(40, q + 5))
            yield {
                "max_size": s,
                "webp_quality": q,
                "thumb_max": thumb_max,
                "thumb_quality": thumb_quality,
                "normal_max": normal_max,
                "normal_quality": normal_quality,
            }


def optimize_vrm_to_target(
    input_path: Path,
    output_path: Path,
    *,
    target_mb: float,
    max_size: int,
    webp_quality: int,
    thumb_max: int,
    thumb_quality: int,
    normal_max: int,
    normal_quality: int,
    max_attempts: int = 12,
) -> None:
    """Try a small set of settings until the output meets target_mb.

    IMPORTANT: Each attempt reloads the original file to avoid stacking lossy edits.
    """

    target_bytes = int(target_mb * 1024 * 1024)
    best_size = None
    best_cfg = None

    attempts = 0
    for cfg in _candidate_settings_for_target(
        start_max_size=max_size,
        start_webp_quality=webp_quality,
        start_thumb_max=thumb_max,
        start_thumb_quality=thumb_quality,
        start_normal_max=normal_max,
        start_normal_quality=normal_quality,
    ):
        attempts += 1
        if attempts > max_attempts:
            break

        print(
            "Attempt",
            attempts,
            f"(max={cfg['max_size']}, q={cfg['webp_quality']}, thumb={cfg['thumb_max']}/{cfg['thumb_quality']}, normal={cfg['normal_max']}/{cfg['normal_quality']})",
        )

        optimize_vrm_file(
            input_path,
            output_path,
            max_size=cfg["max_size"],
            webp_quality=cfg["webp_quality"],
            thumb_max=cfg["thumb_max"],
            thumb_quality=cfg["thumb_quality"],
            normal_max=cfg["normal_max"],
            normal_quality=cfg["normal_quality"],
        )

        out_size = os.path.getsize(output_path)
        if best_size is None or out_size < best_size:
            best_size = out_size
            best_cfg = cfg

        if out_size <= target_bytes:
            print(
                f"Hit target: {out_size / (1024 * 1024):.2f}MB <= {target_mb:.2f}MB",
            )
            return

    if best_size is not None and best_cfg is not None:
        print(
            f"Could not reach target {target_mb:.2f}MB within {attempts} attempts; best was {best_size / (1024 * 1024):.2f}MB",
            f"(max={best_cfg['max_size']}, q={best_cfg['webp_quality']}).",
        )


def main() -> int:
    p = argparse.ArgumentParser(description="Optimize embedded textures inside a VRM (GLB).")
    p.add_argument("inputs", nargs="+", help="One or more .vrm file paths")
    p.add_argument(
        "--suffix",
        default="_optimized_5mb",
        help="Suffix added before extension for output files (default: _optimized_5mb)",
    )
    p.add_argument(
        "--inplace",
        action="store_true",
        help="Overwrite input files instead of creating suffixed outputs.",
    )

    p.add_argument(
        "--target-mb",
        type=float,
        default=None,
        help="Try a small set of settings to reach this size (MB). Each attempt reloads the original input (no stacking).",
    )

    # Defaults match your original script
    p.add_argument("--max-size", type=int, default=512, help="Max dimension for general textures")
    p.add_argument("--webp-quality", type=int, default=60, help="WebP quality for general textures")
    p.add_argument("--thumb-max", type=int, default=512, help="Max dimension for thumbnails")
    p.add_argument("--thumb-quality", type=int, default=45, help="WebP quality for thumbnails")
    p.add_argument("--normal-max", type=int, default=512, help="Max dimension for normal maps")
    p.add_argument("--normal-quality", type=int, default=70, help="WebP quality for normal maps")

    args = p.parse_args()

    for raw in args.inputs:
        input_path = Path(raw).expanduser().resolve()
        if not input_path.exists():
            raise SystemExit(f"Input not found: {input_path}")
        if input_path.suffix.lower() != ".vrm":
            raise SystemExit(f"Not a .vrm file: {input_path}")

        if args.inplace:
            output_path = input_path
        else:
            output_path = input_path.with_name(f"{input_path.stem}{args.suffix}{input_path.suffix}")

        if args.target_mb is not None:
            optimize_vrm_to_target(
                input_path,
                output_path,
                target_mb=args.target_mb,
                max_size=args.max_size,
                webp_quality=args.webp_quality,
                thumb_max=args.thumb_max,
                thumb_quality=args.thumb_quality,
                normal_max=args.normal_max,
                normal_quality=args.normal_quality,
            )
        else:
            optimize_vrm_file(
                input_path,
                output_path,
                max_size=args.max_size,
                webp_quality=args.webp_quality,
                thumb_max=args.thumb_max,
                thumb_quality=args.thumb_quality,
                normal_max=args.normal_max,
                normal_quality=args.normal_quality,
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())