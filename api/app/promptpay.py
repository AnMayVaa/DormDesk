"""PromptPay QR (Thai QR Payment, EMVCo merchant-presented format) generated in-house — no external service.

payload = TLV fields:  00 payload format · 01 point of initiation (11 static / 12 one-time with amount)
                       29 merchant account (AID A000000677010111 + mobile 0066xxxxxxxxx or 13-digit tax/national id)
                       58 country TH · 53 currency 764 (THB) · 54 amount · 63 CRC-16/CCITT-FALSE
"""
import io

import segno

AID = "A000000677010111"


def _tlv(tag: str, value: str) -> str:
    return f"{tag}{len(value):02d}{value}"


def crc16(data: str) -> str:
    crc = 0xFFFF
    for b in data.encode("ascii"):
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if crc & 0x8000 else (crc << 1)
            crc &= 0xFFFF
    return f"{crc:04X}"


def payload(promptpay_id: str, amount_satang: int = 0) -> str:
    pid = "".join(ch for ch in promptpay_id if ch.isdigit())
    if len(pid) == 10:                       # mobile number 0812345678 -> 0066812345678
        acct = _tlv("01", "0066" + pid[1:])
    elif len(pid) == 13:                     # national id / tax id
        acct = _tlv("02", pid)
    else:
        raise ValueError("PromptPay id must be a 10-digit phone or 13-digit id")
    body = (_tlv("00", "01") + _tlv("01", "12" if amount_satang else "11") + _tlv("29", _tlv("00", AID) + acct)
            + _tlv("58", "TH") + _tlv("53", "764") + (_tlv("54", f"{amount_satang / 100:.2f}") if amount_satang else ""))
    body += "6304"
    return body + crc16(body)


def svg(data: str, scale: int = 5, title: str = "") -> bytes:
    """QR as SVG (served with img-src 'self', allowed by the CSP)."""
    out = io.BytesIO()
    segno.make(data, error="m").save(out, kind="svg", scale=scale, border=3, dark="#1f2733", light="#ffffff",
                                     title=title or None, xmldecl=False, svgns=True)
    return out.getvalue()


def labelled_svg(data: str, label: str, sub: str = "") -> bytes:
    """Printable QR card for a facility: QR + name underneath (owner prints and sticks it at the desk/door)."""
    q = segno.make(data, error="q")
    w, h = q.symbol_size(scale=10, border=3)
    out = io.BytesIO()
    q.save(out, kind="svg", scale=10, border=3, dark="#1f2733", xmldecl=False, svgns=True, nl=False)
    inner = out.getvalue().decode()
    inner = inner[inner.index(">") + 1: inner.rindex("</svg>")]
    esc = lambda s: s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    H = h + 110
    doc = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{H}" viewBox="0 0 {w} {H}">'
           f'<rect width="{w}" height="{H}" fill="#fff"/>{inner}'
           f'<text x="{w // 2}" y="{h + 35}" text-anchor="middle" font-family="Prompt, sans-serif" font-size="30" '
           f'font-weight="600" fill="#1f2733">{esc(label)}</text>'
           f'<text x="{w // 2}" y="{h + 75}" text-anchor="middle" font-family="Prompt, sans-serif" font-size="20" '
           f'fill="#5f6b7c">{esc(sub)}</text></svg>')
    return doc.encode()
