from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / 'public'
root.mkdir(exist_ok=True)

for size in (192, 512):
    scale = size / 512
    image = Image.new('RGB', (size, size), '#0b1010')
    draw = ImageDraw.Draw(image)
    def box(coords):
        return tuple(round(value * scale) for value in coords)
    draw.rounded_rectangle(box((0, 0, 511, 511)), radius=round(118 * scale), fill='#0b1010')
    draw.ellipse(box((82, 82, 430, 430)), fill='#172323')
    draw.line(box((133, 256, 379, 256)), fill='#cbf16b', width=round(26 * scale))
    for x, y1, y2 in ((164, 206, 306), (195, 183, 329), (317, 183, 329), (348, 206, 306)):
        draw.line(box((x, y1, x, y2)), fill='#cbf16b', width=round(24 * scale))
    image.save(root / f'icon-{size}.png')
