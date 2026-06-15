from __future__ import annotations

from dataclasses import dataclass
from html import escape
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


OUT_DIR = Path("C:/Users/denla/Documents/incidents64-db-er-diagram")
OUT_DIR.mkdir(parents=True, exist_ok=True)

PNG = OUT_DIR / "digital-observer-er-diagram.png"
PDF = OUT_DIR / "digital-observer-er-diagram.pdf"
SVG = OUT_DIR / "digital-observer-er-diagram.svg"

W, H = 5000, 3000
BG = "#f8fbfa"
INK = "#10231f"
MUTED = "#5f716c"
GRID = "#e7efec"
LINE = "#62756f"
CARD = "#ffffff"
SHADOW = "#d8e5e1"
TEAL = "#0f766e"
BLUE = "#2563eb"
VIOLET = "#7c3aed"
RED = "#dc2626"
AMBER = "#d97706"
MINT = "#18b99b"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "C:/Windows/Fonts/seguisb.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


F_TABLE = font(34, True)
F_FIELD = font(27)
F_FIELD_B = font(27, True)
F_TAG = font(21, True)
F_REL = font(24, True)


@dataclass(frozen=True)
class Table:
    title: str
    x: int
    y: int
    w: int
    color: str
    fields: tuple[tuple[str, str, str], ...]


TABLES: dict[str, Table] = {
    "User": Table("Пользователь", 120, 760, 760, TEAL, (
        ("PK", "id", "String"),
        ("UQ", "email", "String"),
        ("", "name", "String"),
        ("", "role", "Role"),
        ("", "emailConfirmed", "Boolean"),
    )),
    "Team": Table("Команда", 1280, 120, 650, BLUE, (
        ("PK", "id", "String"),
        ("", "name", "String"),
        ("", "description", "String?"),
    )),
    "Microservice": Table("Микросервис", 1280, 650, 880, BLUE, (
        ("PK", "id", "String"),
        ("FK", "userId", "User?"),
        ("FK", "teamId", "Team?"),
        ("", "name", "String"),
        ("", "url", "String"),
        ("", "environment", "Environment"),
        ("", "status", "ServiceStatus"),
        ("", "thresholds", "CPU/RAM/response"),
    )),
    "ServiceDependency": Table("Зависимость сервисов", 1280, 1540, 880, BLUE, (
        ("PK", "id", "String"),
        ("FK", "sourceId", "Microservice"),
        ("FK", "targetId", "Microservice"),
        ("UQ", "sourceId + targetId", "unique"),
    )),
    "HealthCheck": Table("Проверка состояния", 2600, 280, 760, VIOLET, (
        ("PK", "id", "String"),
        ("FK", "serviceId", "Microservice"),
        ("", "success", "Boolean"),
        ("", "statusCode", "Int?"),
        ("", "responseTimeMs", "Int?"),
        ("", "checkedAt", "DateTime"),
    )),
    "Metric": Table("Метрика", 2600, 900, 760, VIOLET, (
        ("PK", "id", "String"),
        ("FK", "serviceId", "Microservice"),
        ("", "availability", "Float"),
        ("", "responseTimeMs", "Int"),
        ("", "cpu / ram / disk", "Float?"),
        ("", "requestsPerMinute", "Int?"),
        ("IDX", "serviceId + createdAt", "index"),
    )),
    "Incident": Table("Инцидент", 2600, 1620, 760, RED, (
        ("PK", "id", "String"),
        ("FK", "serviceId", "Microservice"),
        ("FK", "assignedToId", "User?"),
        ("", "title", "String"),
        ("", "severity", "Severity"),
        ("", "status", "IncidentStatus"),
        ("", "startedAt / resolvedAt", "DateTime"),
    )),
    "NotificationRule": Table("Правило уведомлений", 3940, 720, 780, AMBER, (
        ("PK", "id", "String"),
        ("FK", "userId", "User"),
        ("", "type", "NotificationType"),
        ("", "channel", "NotificationChannel"),
        ("", "enabled", "Boolean"),
        ("", "config", "Json?"),
    )),
    "Notification": Table("Уведомление", 3940, 1580, 780, AMBER, (
        ("PK", "id", "String"),
        ("FK", "serviceId", "Microservice?"),
        ("FK", "incidentId", "Incident?"),
        ("FK", "ruleId", "NotificationRule?"),
        ("", "channel", "NotificationChannel"),
        ("", "sentAt / failedAt", "DateTime?"),
    )),
    "Report": Table("Отчет SLA/SLO", 120, 1940, 760, MINT, (
        ("PK", "id", "String"),
        ("FK", "userId", "User?"),
        ("", "periodFrom / periodTo", "DateTime"),
        ("", "uptime", "Float"),
        ("", "incidentCount", "Int"),
        ("", "fileUrl", "String?"),
    )),
    "AuditLog": Table("Журнал аудита", 980, 1940, 760, MINT, (
        ("PK", "id", "String"),
        ("FK", "userId", "User?"),
        ("", "action", "String"),
        ("", "entityType / entityId", "String?"),
        ("", "createdAt", "DateTime"),
        ("IDX", "userId + createdAt", "index"),
    )),
}


RELATIONS = (
    ("User", "Microservice", "1", "N", "создает"),
    ("Team", "Microservice", "1", "N", "группирует"),
    ("Microservice", "ServiceDependency", "1", "N", "source / target"),
    ("Microservice", "HealthCheck", "1", "N", "проверки"),
    ("Microservice", "Metric", "1", "N", "метрики"),
    ("Microservice", "Incident", "1", "N", "инциденты"),
    ("User", "NotificationRule", "1", "N", "правила"),
    ("NotificationRule", "Notification", "1", "N", "создает"),
    ("Incident", "Notification", "1", "N", "триггер"),
    ("User", "Report", "1", "N", "отчеты"),
    ("User", "AuditLog", "1", "N", "аудит"),
)


def table_height(table: Table) -> int:
    return 104 + len(table.fields) * 42 + 24


def rect(name: str) -> tuple[int, int, int, int]:
    table = TABLES[name]
    return table.x, table.y, table.x + table.w, table.y + table_height(table)


def anchor(name: str, side: str) -> tuple[int, int]:
    x1, y1, x2, y2 = rect(name)
    if side == "left":
        return x1, (y1 + y2) // 2
    if side == "right":
        return x2, (y1 + y2) // 2
    if side == "top":
        return (x1 + x2) // 2, y1
    return (x1 + x2) // 2, y2


def port(name: str, side: str, ratio: float = 0.5) -> tuple[int, int]:
    x1, y1, x2, y2 = rect(name)
    if side == "left":
        return x1, int(y1 + (y2 - y1) * ratio)
    if side == "right":
        return x2, int(y1 + (y2 - y1) * ratio)
    if side == "top":
        return int(x1 + (x2 - x1) * ratio), y1
    return int(x1 + (x2 - x1) * ratio), y2


def sides(a: str, b: str) -> tuple[str, str]:
    ax1, ay1, ax2, ay2 = rect(a)
    bx1, by1, bx2, by2 = rect(b)
    dx = (bx1 + bx2) / 2 - (ax1 + ax2) / 2
    dy = (by1 + by2) / 2 - (ay1 + ay2) / 2
    if abs(dx) >= abs(dy):
        return ("right", "left") if dx > 0 else ("left", "right")
    return ("bottom", "top") if dy > 0 else ("top", "bottom")


def relation_points(a: str, b: str, offset: int = 0) -> list[tuple[int, int]]:
    custom: dict[tuple[str, str], list[tuple[int, int]]] = {
        ("User", "Microservice"): [
            port("User", "right", 0.42),
            (1040, port("User", "right", 0.42)[1]),
            (1040, port("Microservice", "left", 0.36)[1]),
            port("Microservice", "left", 0.36),
        ],
        ("Team", "Microservice"): [
            port("Team", "bottom", 0.50),
            (port("Team", "bottom", 0.50)[0], 500),
            (port("Microservice", "top", 0.50)[0], 500),
            port("Microservice", "top", 0.50),
        ],
        ("Microservice", "HealthCheck"): [
            port("Microservice", "right", 0.20),
            (2360, port("Microservice", "right", 0.20)[1]),
            (2360, port("HealthCheck", "left", 0.45)[1]),
            port("HealthCheck", "left", 0.45),
        ],
        ("Microservice", "Metric"): [
            port("Microservice", "right", 0.38),
            (2310, port("Microservice", "right", 0.38)[1]),
            (2310, port("Metric", "left", 0.34)[1]),
            port("Metric", "left", 0.34),
        ],
        ("Microservice", "Incident"): [
            port("Microservice", "bottom", 0.82),
            (port("Microservice", "bottom", 0.82)[0], 1460),
            (2460, 1460),
            (2460, port("Incident", "left", 0.42)[1]),
            port("Incident", "left", 0.42),
        ],
        ("Microservice", "ServiceDependency"): [
            port("Microservice", "bottom", 0.50),
            port("ServiceDependency", "top", 0.50),
        ],
        ("User", "NotificationRule"): [
            port("User", "top", 0.74),
            (port("User", "top", 0.74)[0], 60),
            (3800, 60),
            (3800, port("NotificationRule", "left", 0.42)[1]),
            port("NotificationRule", "left", 0.42),
        ],
        ("NotificationRule", "Notification"): [
            port("NotificationRule", "bottom", 0.50),
            port("Notification", "top", 0.50),
        ],
        ("Incident", "Notification"): [
            port("Incident", "right", 0.48),
            (3710, port("Incident", "right", 0.48)[1]),
            (3710, port("Notification", "left", 0.45)[1]),
            port("Notification", "left", 0.45),
        ],
        ("User", "Report"): [
            port("User", "bottom", 0.32),
            (port("User", "bottom", 0.32)[0], 1800),
            (port("Report", "top", 0.50)[0], 1800),
            port("Report", "top", 0.50),
        ],
        ("User", "AuditLog"): [
            port("User", "bottom", 0.78),
            (port("User", "bottom", 0.78)[0], 1845),
            (910, 1845),
            (910, port("AuditLog", "left", 0.36)[1]),
            port("AuditLog", "left", 0.36),
        ],
        ("User", "Report"): [
            port("User", "bottom", 0.34),
            (port("User", "bottom", 0.34)[0], 1840),
            (port("Report", "top", 0.50)[0], 1840),
            port("Report", "top", 0.50),
        ],
        ("Report", "AuditLog"): [
            port("Report", "right", 0.42),
            (930, port("Report", "right", 0.42)[1]),
            (930, port("AuditLog", "top", 0.50)[1]),
            port("AuditLog", "top", 0.50),
        ],
    }
    if (a, b) in custom:
        return custom[(a, b)]
    if (b, a) in custom:
        return list(reversed(custom[(b, a)]))

    s1, s2 = sides(a, b)
    x1, y1 = anchor(a, s1)
    x2, y2 = anchor(b, s2)
    if s1 in ("left", "right"):
        y1 += offset
    else:
        x1 += offset
    if s2 in ("left", "right"):
        y2 += offset
    else:
        x2 += offset

    if s1 in ("left", "right"):
        mx = (x1 + x2) // 2
        return [(x1, y1), (mx, y1), (mx, y2), (x2, y2)]
    my = (y1 + y2) // 2
    return [(x1, y1), (x1, my), (x2, my), (x2, y2)]


def draw_grid(draw: ImageDraw.ImageDraw) -> None:
    for x in range(0, W, 90):
        draw.line([(x, 0), (x, H)], fill=GRID, width=1)
    for y in range(0, H, 90):
        draw.line([(0, y), (W, y)], fill=GRID, width=1)


def draw_relation(draw: ImageDraw.ImageDraw, a: str, b: str, one: str, many: str, label: str, offset: int) -> None:
    pts = relation_points(a, b, offset)
    draw.line(pts, fill=LINE, width=5, joint="curve")
    for px, py in (pts[0], pts[-1]):
        draw.ellipse((px - 8, py - 8, px + 8, py + 8), fill=LINE)
    mid_index = max(0, len(pts) // 2 - 1)
    lx = (pts[mid_index][0] + pts[mid_index + 1][0]) // 2
    ly = (pts[mid_index][1] + pts[mid_index + 1][1]) // 2
    text = f"{one}:{many} {label}"
    tw = draw.textlength(text, font=F_REL)
    draw.rounded_rectangle((lx - tw / 2 - 14, ly - 22, lx + tw / 2 + 14, ly + 22), radius=12, fill="#ffffff", outline="#d2dfdb", width=2)
    draw.text((lx - tw / 2, ly - 16), text, font=F_REL, fill=INK)


def draw_table(draw: ImageDraw.ImageDraw, name: str) -> None:
    table = TABLES[name]
    x, y, x2, y2 = rect(name)
    draw.rounded_rectangle((x + 12, y + 16, x2 + 12, y2 + 16), radius=28, fill=SHADOW)
    draw.rounded_rectangle((x, y, x2, y2), radius=28, fill=CARD, outline="#c5d6d1", width=3)
    draw.rounded_rectangle((x, y, x2, y + 88), radius=28, fill=table.color)
    draw.rectangle((x, y + 58, x2, y + 88), fill=table.color)
    draw.text((x + 32, y + 24), f"{table.title} ({name})", font=F_TABLE, fill="white")

    fy = y + 122
    for tag, field, typ in table.fields:
        if tag:
            tag_w = 54 if tag in ("PK", "FK", "UQ") else 72
            tag_color = {"PK": TEAL, "FK": BLUE, "UQ": AMBER, "IDX": VIOLET}.get(tag, "#64748b")
            draw.rounded_rectangle((x + 30, fy - 5, x + 30 + tag_w, fy + 27), radius=9, fill=tag_color)
            draw.text((x + 40, fy), tag, font=F_TAG, fill="white")
            text_x = x + 30 + tag_w + 18
        else:
            draw.ellipse((x + 45, fy + 8, x + 57, fy + 20), fill="#9db0ab")
            text_x = x + 74
        draw.text((text_x, fy - 2), field, font=F_FIELD_B if tag in ("PK", "FK") else F_FIELD, fill=INK)
        tw = draw.textlength(typ, font=F_FIELD)
        draw.text((x2 - 34 - tw, fy - 2), typ, font=F_FIELD, fill=MUTED)
        fy += 42


def render_png() -> Image.Image:
    image = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(image)
    draw_grid(draw)
    offsets: dict[tuple[str, str], int] = {}
    for a, b, one, many, label in RELATIONS:
        key = tuple(sorted((a, b)))
        offsets[key] = offsets.get(key, -48) + 48
        draw_relation(draw, a, b, one, many, label, offsets[key])
    for name in TABLES:
        draw_table(draw, name)
    return image


def svg_text(x: float, y: float, text: str, size: int, color: str, bold: bool = False) -> str:
    weight = "700" if bold else "400"
    return f'<text x="{x:.0f}" y="{y:.0f}" font-family="Segoe UI, Arial, sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}">{escape(text)}</text>'


def render_svg() -> str:
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        f'<rect width="{W}" height="{H}" fill="{BG}"/>',
    ]
    for x in range(0, W, 90):
        parts.append(f'<line x1="{x}" y1="0" x2="{x}" y2="{H}" stroke="{GRID}" stroke-width="1"/>')
    for y in range(0, H, 90):
        parts.append(f'<line x1="0" y1="{y}" x2="{W}" y2="{y}" stroke="{GRID}" stroke-width="1"/>')

    offsets: dict[tuple[str, str], int] = {}
    for a, b, one, many, label in RELATIONS:
        key = tuple(sorted((a, b)))
        offsets[key] = offsets.get(key, -48) + 48
        pts = relation_points(a, b, offsets[key])
        d = " ".join(("M" if i == 0 else "L") + f" {x} {y}" for i, (x, y) in enumerate(pts))
        parts.append(f'<path d="{d}" fill="none" stroke="{LINE}" stroke-width="5" stroke-linejoin="round"/>')
        for px, py in (pts[0], pts[-1]):
            parts.append(f'<circle cx="{px}" cy="{py}" r="8" fill="{LINE}"/>')
        mid_index = max(0, len(pts) // 2 - 1)
        lx = (pts[mid_index][0] + pts[mid_index + 1][0]) // 2
        ly = (pts[mid_index][1] + pts[mid_index + 1][1]) // 2
        text = f"{one}:{many} {label}"
        width = max(140, len(text) * 15)
        parts.append(f'<rect x="{lx - width/2 - 14:.0f}" y="{ly - 24}" width="{width + 28:.0f}" height="48" rx="12" fill="#ffffff" stroke="#d2dfdb" stroke-width="2"/>')
        parts.append(svg_text(lx - width / 2, ly + 8, text, 24, INK, True))

    for name, table in TABLES.items():
        x, y, x2, y2 = rect(name)
        parts.extend([
            f'<rect x="{x+12}" y="{y+16}" width="{table.w}" height="{y2-y}" rx="28" fill="{SHADOW}"/>',
            f'<rect x="{x}" y="{y}" width="{table.w}" height="{y2-y}" rx="28" fill="{CARD}" stroke="#c5d6d1" stroke-width="3"/>',
            f'<path d="M {x+28} {y} H {x2-28} Q {x2} {y} {x2} {y+28} V {y+88} H {x} V {y+28} Q {x} {y} {x+28} {y}" fill="{table.color}"/>',
            f'<rect x="{x}" y="{y+58}" width="{table.w}" height="30" fill="{table.color}"/>',
            svg_text(x + 32, y + 58, f"{table.title} ({name})", 34, "#ffffff", True),
        ])
        fy = y + 146
        for tag, field, typ in table.fields:
            if tag:
                tag_w = 54 if tag in ("PK", "FK", "UQ") else 72
                tag_color = {"PK": TEAL, "FK": BLUE, "UQ": AMBER, "IDX": VIOLET}.get(tag, "#64748b")
                parts.append(f'<rect x="{x+30}" y="{fy-29}" width="{tag_w}" height="32" rx="9" fill="{tag_color}"/>')
                parts.append(svg_text(x + 40, fy - 6, tag, 21, "#ffffff", True))
                text_x = x + 30 + tag_w + 18
            else:
                parts.append(f'<circle cx="{x+51}" cy="{fy-13}" r="6" fill="#9db0ab"/>')
                text_x = x + 74
            parts.append(svg_text(text_x, fy - 4, field, 27, INK, tag in ("PK", "FK")))
            parts.append(svg_text(x2 - 300, fy - 4, typ, 27, MUTED))
            fy += 42
    parts.append("</svg>")
    return "\n".join(parts)


if __name__ == "__main__":
    image = render_png()
    image.save(PNG, quality=98)
    image.save(PDF, "PDF", resolution=300.0)
    SVG.write_text(render_svg(), encoding="utf-8")
    print(PNG)
    print(PDF)
    print(SVG)
