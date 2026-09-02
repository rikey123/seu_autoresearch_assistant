#!/usr/bin/env python3
"""figure_svg_to_pptx.py - research workbench figure sidecar.

Converts a standalone SVG figure (the constrained element vocabulary produced
by the figure-drawing workflow: rect/circle/ellipse/line/polyline/polygon/text
with plain px coordinates) into a Microsoft PowerPoint file made of NATIVE,
editable shapes via python-pptx. The raw SVG is not embedded as a bitmap.

Usage:
    python figure_svg_to_pptx.py <svg_path> <pptx_path> [title]

Prints a JSON summary on stdout on success; exits non-zero with a message on
stderr on failure. The calling workflow node degrades gracefully when this
sidecar is not configured, so this script only needs to be honest about its
own failures.

Requires: python-pptx (pip install python-pptx). Nothing else beyond stdlib.
"""

import json
import re
import sys

EMU_PER_PX = 9525  # 914400 EMU per inch / 96 px per inch
DEFAULT_WIDTH = 900.0
DEFAULT_HEIGHT = 560.0

NAMED_COLORS = {
    "black": "000000",
    "white": "FFFFFF",
    "red": "FF0000",
    "green": "008000",
    "blue": "0000FF",
    "gray": "808080",
    "grey": "808080",
    "orange": "FFA500",
}


def fail(message):
    sys.stderr.write("figure_svg_to_pptx: %s\n" % message)
    sys.exit(1)


def local_name(tag):
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def parse_length(value, fallback=None):
    if value is None:
        return fallback
    text = str(value).strip()
    if text.endswith("px"):
        text = text[:-2]
    try:
        return float(text)
    except ValueError:
        return fallback


def parse_color(value):
    """Returns a 6-digit RGB hex string, 'none', or None (unspecified)."""
    if value is None:
        return None
    text = str(value).strip().lower()
    if not text:
        return None
    if text == "none":
        return "none"
    if text.startswith("#"):
        hex_part = text[1:]
        if len(hex_part) == 3:
            hex_part = "".join(ch * 2 for ch in hex_part)
        if len(hex_part) >= 6 and re.match(r"^[0-9a-f]{6}$", hex_part[:6]):
            return hex_part[:6].upper()
        return None
    return NAMED_COLORS.get(text)


def parse_transform_translation(value):
    """Extracts the translation part of translate(..) / matrix(..)."""
    if not value:
        return 0.0, 0.0
    tx = ty = 0.0
    for name, args in re.findall(r"(translate|matrix)\s*\(([^)]*)\)", str(value)):
        numbers = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?(?:e-?\d+)?", args)]
        if name == "translate" and numbers:
            tx += numbers[0]
            ty += numbers[1] if len(numbers) > 1 else 0.0
        elif name == "matrix" and len(numbers) >= 6:
            tx += numbers[4]
            ty += numbers[5]
    return tx, ty


def collect_elements(node, dx=0.0, dy=0.0, output=None):
    """Depth-first flatten of drawable elements with accumulated translation."""
    if output is None:
        output = []
    for child in node:
        tag = local_name(child.tag)
        child_dx, child_dy = dx, dy
        if tag == "g":
            gtx, gty = parse_transform_translation(child.get("transform"))
            child_dx += gtx
            child_dy += gty
        if tag in ("rect", "circle", "ellipse", "line", "polyline", "polygon", "text"):
            output.append((tag, child, child_dx, child_dy))
        collect_elements(child, child_dx, child_dy, output)
    return output


def main(argv):
    if len(argv) < 3:
        fail("usage: figure_svg_to_pptx.py <svg_path> <pptx_path> [title]")
    svg_path, pptx_path = argv[1], argv[2]
    title = argv[3] if len(argv) > 3 else "Scientific figure"

    try:
        import xml.etree.ElementTree as ET
        from pptx import Presentation
        from pptx.util import Emu, Pt
        from pptx.dml.color import RGBColor
        from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
    except ImportError as error:
        fail("python-pptx is required: pip install python-pptx (%s)" % error)

    try:
        root = ET.parse(svg_path).getroot()
    except (ET.ParseError, OSError) as error:
        fail("failed to parse SVG %s: %s" % (svg_path, error))
    if local_name(root.tag) != "svg":
        fail("not an SVG document: %s" % svg_path)

    width = parse_length(root.get("width"), None)
    height = parse_length(root.get("height"), None)
    if width is None or height is None:
        viewBox = str(root.get("viewBox") or "").split()
        if len(viewBox) >= 4:
            width = width if width is not None else parse_length(viewBox[2], DEFAULT_WIDTH)
            height = height if height is not None else parse_length(viewBox[3], DEFAULT_HEIGHT)
    width = width or DEFAULT_WIDTH
    height = height or DEFAULT_HEIGHT

    presentation = Presentation()
    presentation.slide_width = Emu(int(round(width * EMU_PER_PX)))
    presentation.slide_height = Emu(int(round(height * EMU_PER_PX)))
    presentation.core_properties.title = title
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])  # blank

    def style_fill(shape, color_value):
        color = parse_color(color_value)
        if color == "none":
            shape.fill.background()
        elif color is None:
            shape.fill.solid()
            shape.fill.fore_color.rgb = RGBColor.from_string("000000")
        else:
            shape.fill.solid()
            shape.fill.fore_color.rgb = RGBColor.from_string(color)

    def style_line(line_format, color_value, width_value):
        color = parse_color(color_value)
        if color is None:
            color = "000000"
        line_format.color.rgb = RGBColor.from_string(color)
        if width_value:
            line_format.width = Emu(int(round(parse_length(width_value, 1.0) * EMU_PER_PX)))

    shape_count = 0
    for tag, element, dx, dy in collect_elements(root):
        if tag == "rect":
            x = parse_length(element.get("x"), 0.0) + dx
            y = parse_length(element.get("y"), 0.0) + dy
            w = parse_length(element.get("width"), 0.0)
            h = parse_length(element.get("height"), 0.0)
            if w <= 0 or h <= 0:
                continue
            rx = parse_length(element.get("rx"), 0.0)
            shape_kind = MSO_SHAPE.ROUNDED_RECTANGLE if rx and rx > 0 else MSO_SHAPE.RECTANGLE
            shape = slide.shapes.add_shape(shape_kind, Emu(int(x * EMU_PER_PX)), Emu(int(y * EMU_PER_PX)), Emu(int(w * EMU_PER_PX)), Emu(int(h * EMU_PER_PX)))
            shape.shadow.inherit = False
            style_fill(shape, element.get("fill"))
            if element.get("stroke"):
                style_line(shape.line, element.get("stroke"), element.get("stroke-width"))
            else:
                shape.line.fill.background()
            shape_count += 1
        elif tag in ("circle", "ellipse"):
            cx = parse_length(element.get("cx"), 0.0) + dx
            cy = parse_length(element.get("cy"), 0.0) + dy
            rx = parse_length(element.get("r") if tag == "circle" else element.get("rx"), 0.0)
            ry = parse_length(element.get("r") if tag == "circle" else element.get("ry"), 0.0)
            if rx <= 0 or ry <= 0:
                continue
            shape = slide.shapes.add_shape(MSO_SHAPE.OVAL, Emu(int((cx - rx) * EMU_PER_PX)), Emu(int((cy - ry) * EMU_PER_PX)), Emu(int(2 * rx * EMU_PER_PX)), Emu(int(2 * ry * EMU_PER_PX)))
            shape.shadow.inherit = False
            style_fill(shape, element.get("fill"))
            if element.get("stroke"):
                style_line(shape.line, element.get("stroke"), element.get("stroke-width"))
            else:
                shape.line.fill.background()
            shape_count += 1
        elif tag == "line":
            x1 = parse_length(element.get("x1"), 0.0) + dx
            y1 = parse_length(element.get("y1"), 0.0) + dy
            x2 = parse_length(element.get("x2"), 0.0) + dx
            y2 = parse_length(element.get("y2"), 0.0) + dy
            connector = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Emu(int(x1 * EMU_PER_PX)), Emu(int(y1 * EMU_PER_PX)), Emu(int(x2 * EMU_PER_PX)), Emu(int(y2 * EMU_PER_PX)))
            style_line(connector.line, element.get("stroke", "#000000"), element.get("stroke-width"))
            shape_count += 1
        elif tag in ("polyline", "polygon"):
            points_text = str(element.get("points") or "")
            pairs = re.findall(r"-?\d+(?:\.\d+)?", points_text)
            if len(pairs) < 4:
                continue
            coordinates = [(float(pairs[i]) + dx, float(pairs[i + 1]) + dy) for i in range(0, len(pairs) - 1, 2)]
            if len(coordinates) < 2:
                continue
            for (ax, ay), (bx, by) in zip(coordinates, coordinates[1:]):
                connector = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Emu(int(ax * EMU_PER_PX)), Emu(int(ay * EMU_PER_PX)), Emu(int(bx * EMU_PER_PX)), Emu(int(by * EMU_PER_PX)))
                style_line(connector.line, element.get("stroke", "#000000"), element.get("stroke-width"))
                shape_count += 1
        elif tag == "text":
            content = "".join(element.itertext()).strip()
            if not content:
                continue
            x = parse_length(element.get("x"), 0.0) + dx
            y = parse_length(element.get("y"), 0.0) + dy
            font_size_px = parse_length(element.get("font-size"), 14.0)
            anchor = str(element.get("text-anchor") or "start").strip().lower()
            est_width = max(len(content) * font_size_px * 0.62, font_size_px * 2)
            if anchor == "middle":
                left = x - est_width / 2
            elif anchor == "end":
                left = x - est_width
            else:
                left = x
            # SVG y is the text baseline; shift the box up by ~one font size.
            top = y - font_size_px
            box = slide.shapes.add_textbox(Emu(int(left * EMU_PER_PX)), Emu(int(top * EMU_PER_PX)), Emu(int(est_width * EMU_PER_PX)), Emu(int(font_size_px * 1.5 * EMU_PER_PX)))
            box.word_wrap = False
            box.shadow.inherit = False
            box.fill.background()
            box.line.fill.background()
            frame = box.text_frame
            frame.margin_left = frame.margin_right = frame.margin_top = frame.margin_bottom = 0
            paragraph = frame.paragraphs[0]
            run = paragraph.add_run()
            run.text = content
            font = run.font
            font.size = Pt(max(font_size_px * 0.75, 1.0))
            font.name = "Arial"
            if str(element.get("font-weight") or "").lower() in ("bold", "700", "800", "900"):
                font.bold = True
            color = parse_color(element.get("fill"))
            if color not in (None, "none"):
                font.color.rgb = RGBColor.from_string(color)
            shape_count += 1

    if shape_count == 0:
        fail("no drawable elements found in %s" % svg_path)

    try:
        presentation.save(pptx_path)
    except OSError as error:
        fail("failed to write %s: %s" % (pptx_path, error))

    sys.stdout.write(json.dumps({
        "ok": True,
        "pptx": pptx_path,
        "shapes": shape_count,
        "slidePx": [int(width), int(height)],
    }))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main(sys.argv)
