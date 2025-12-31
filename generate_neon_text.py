"""generate_neon_text.py

Generate 3D extruded text models (GLB) for neon signs by extracting real
glyph outlines from a .ttf/.otf font and extruding them into meshes.

Why this approach:
- Produces real letter geometry (not rectangles / hulls)
- No Blender required

Dependencies (install yourself):
  pip install trimesh numpy shapely fonttools mapbox-earcut tqdm

Notes:
- `trimesh.creation.extrude_polygon` triangulates via shapely + earcut.
- Works best with a bold font like Orbitron-Bold.
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import Iterable, List, Tuple

import numpy as np
import trimesh
from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union
from tqdm import tqdm


LOGGER = logging.getLogger("generate_neon_text")


class _ContourPen(BasePen):
    """Collect contours as lists of points from fontTools glyph drawing."""

    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.contours: List[List[Tuple[float, float]]] = []
        self._current: List[Tuple[float, float]] = []

    def _moveTo(self, p0):
        self._current = [(float(p0[0]), float(p0[1]))]

    def _lineTo(self, p1):
        self._current.append((float(p1[0]), float(p1[1])))

    def _qCurveToOne(self, p1, p2):
        # Approximate quadratic curves with a polyline.
        # Keep segments modest to avoid heavy meshes.
        x0, y0 = self._current[-1]
        x1, y1 = float(p1[0]), float(p1[1])
        x2, y2 = float(p2[0]), float(p2[1])
        for t in np.linspace(0.0, 1.0, 10)[1:]:
            xt = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * x1 + t**2 * x2
            yt = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * y1 + t**2 * y2
            self._current.append((float(xt), float(yt)))

    def _curveToOne(self, p1, p2, p3):
        # Approximate cubic curves with a polyline.
        x0, y0 = self._current[-1]
        x1, y1 = float(p1[0]), float(p1[1])
        x2, y2 = float(p2[0]), float(p2[1])
        x3, y3 = float(p3[0]), float(p3[1])
        for t in np.linspace(0.0, 1.0, 14)[1:]:
            xt = (
                (1 - t) ** 3 * x0
                + 3 * (1 - t) ** 2 * t * x1
                + 3 * (1 - t) * t**2 * x2
                + t**3 * x3
            )
            yt = (
                (1 - t) ** 3 * y0
                + 3 * (1 - t) ** 2 * t * y1
                + 3 * (1 - t) * t**2 * y2
                + t**3 * y3
            )
            self._current.append((float(xt), float(yt)))

    def _closePath(self):
        if len(self._current) >= 3:
            if self._current[0] != self._current[-1]:
                self._current.append(self._current[0])
            self.contours.append(self._current)
        self._current = []


def _polygons_from_text(font_path: Path, text: str) -> Polygon | MultiPolygon:
    """Convert a string into a shapely Polygon/MultiPolygon in font units."""
    tt = TTFont(str(font_path))
    glyph_set = tt.getGlyphSet()

    cmap = tt.getBestCmap()
    if cmap is None:
        raise RuntimeError("Font has no cmap")

    units_per_em = int(tt["head"].unitsPerEm)

    x_cursor = 0.0
    all_polys: List[Polygon] = []

    for ch in text:
        codepoint = ord(ch)
        glyph_name = cmap.get(codepoint)
        if not glyph_name:
            LOGGER.warning("No glyph for character %r (U+%04X)", ch, codepoint)
            continue

        glyph = glyph_set[glyph_name]
        pen = _ContourPen(glyph_set)
        glyph.draw(pen)

        # Attempt to get horizontal advance (fallback to em).
        try:
            hmtx = tt["hmtx"].metrics[glyph_name]
            advance = float(hmtx[0])
        except Exception:
            advance = float(units_per_em)

        for contour in pen.contours:
            pts = np.array(contour, dtype=np.float64)
            pts[:, 0] += x_cursor

            poly = Polygon(pts)
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_empty:
                continue
            if poly.area < 1.0:
                continue
            all_polys.append(poly)

        x_cursor += advance

    if not all_polys:
        raise RuntimeError(f"No polygons generated for text: {text!r}")

    merged = unary_union(all_polys)
    if merged.is_empty:
        raise RuntimeError(f"Union produced empty geometry for text: {text!r}")
    return merged


def _normalize_to_height(poly: Polygon | MultiPolygon, target_height: float) -> Polygon | MultiPolygon:
    minx, miny, maxx, maxy = poly.bounds
    height = max(1e-9, (maxy - miny))
    scale = target_height / height
    scaled = trimesh.transformations.scale_matrix(scale)  # 4x4

    def _apply(p: Polygon) -> Polygon:
        pts = np.asarray(p.exterior.coords)
        pts3 = np.c_[pts[:, 0], pts[:, 1], np.zeros(len(pts)), np.ones(len(pts))]
        out = (scaled @ pts3.T).T
        exterior = [(float(x), float(y)) for x, y in out[:, :2]]
        holes = []
        for ring in p.interiors:
            hpts = np.asarray(ring.coords)
            hpts3 = np.c_[hpts[:, 0], hpts[:, 1], np.zeros(len(hpts)), np.ones(len(hpts))]
            hout = (scaled @ hpts3.T).T
            holes.append([(float(x), float(y)) for x, y in hout[:, :2]])
        return Polygon(exterior, holes)

    if isinstance(poly, Polygon):
        return _apply(poly)
    return MultiPolygon([_apply(p) for p in poly.geoms])


def extrude_text_to_glb(
    *,
    font_path: Path,
    text: str,
    out_path: Path,
    text_height: float,
    extrude_depth: float,
    center: bool = True,
) -> None:
    LOGGER.info("Generating %s -> %s", text, out_path.as_posix())
    poly = _polygons_from_text(font_path, text)
    poly = _normalize_to_height(poly, target_height=text_height)

    # `extrude_polygon` expects a shapely Polygon or MultiPolygon.
    mesh = trimesh.creation.extrude_polygon(poly, height=extrude_depth)
    mesh.remove_duplicate_faces()
    mesh.remove_degenerate_faces()
    mesh.remove_unreferenced_vertices()
    mesh.fix_normals()

    if center:
        mesh.apply_translation(-mesh.bounding_box.centroid)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(out_path)
    LOGGER.info("Wrote %s (verts=%d faces=%d)", out_path.as_posix(), len(mesh.vertices), len(mesh.faces))


def _default_texts() -> List[str]:
    return ["NEXUS", "SHIMATA", "DATA", "CYBER", "TECH", "GRID"]


def _existing_font_default() -> Path | None:
    candidates = [
        Path("public/fonts/Orbitron-Bold.ttf"),
        Path("public/fonts/Orbitron-ExtraBold.ttf"),
        Path("public/fonts/Audiowide-Regular.ttf"),
        Path("public/fonts/Michroma-Regular.ttf"),
    ]
    for p in candidates:
        if p.exists():
            return p
    return None


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate extruded 3D text GLBs for neon signs.")
    parser.add_argument(
        "--font",
        type=Path,
        default=_existing_font_default() or Path("public/fonts/Orbitron-Bold.ttf"),
        help="Path to a .ttf/.otf font file (recommend a bold font).",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("public/models/neon-signs"),
        help="Output directory for generated .glb files.",
    )
    parser.add_argument(
        "--height",
        type=float,
        default=1.0,
        help="Target text height in scene units (Y axis).",
    )
    parser.add_argument(
        "--depth",
        type=float,
        default=0.12,
        help="Extrusion depth in scene units (Z axis).",
    )
    parser.add_argument(
        "--no-center",
        action="store_true",
        help="Do not center geometry at origin.",
    )
    parser.add_argument(
        "--texts",
        nargs="*",
        default=_default_texts(),
        help="Texts to generate (space separated).",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Logging verbosity.",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    if not args.font.exists():
        LOGGER.error("Font not found: %s", args.font)
        return 2

    failures = 0
    for text in tqdm(args.texts, desc="Generating neon GLBs", unit="text"):
        out_path = args.out_dir / f"{text.lower()}.glb"
        try:
            extrude_text_to_glb(
                font_path=args.font,
                text=text,
                out_path=out_path,
                text_height=float(args.height),
                extrude_depth=float(args.depth),
                center=not args.no_center,
            )
        except Exception:
            failures += 1
            LOGGER.exception("Failed to generate %s", text)

    if failures:
        LOGGER.error("Done with %d failures.", failures)
        return 1

    LOGGER.info("Done. Generated %d files in %s", len(args.texts), args.out_dir.as_posix())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
