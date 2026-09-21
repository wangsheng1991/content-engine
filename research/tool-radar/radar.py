#!/usr/bin/env python3
"""Harvest Google autocomplete for candidate 'free tool' families per language.

Autocomplete is NOT search volume. It is first-party evidence that a phrasing is a
real, repeatedly-typed query, and it hands back the exact long-tails that would
become programmatic pages. Output: JSON per family/locale -> sys.argv[1].
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

# family -> {lang: head term}. Native script where the market types native script.
FAMILIES = {
    "upscale": {
        "en": "upscale image", "es": "aumentar resolucion de imagen",
        "pt": "aumentar resolucao de imagem", "id": "memperbesar resolusi foto",
        "vi": "nâng cấp ảnh", "ru": "увеличить разрешение фото",
        "ja": "画像 高画質 化", "ko": "사진 화질 향상", "zh": "图片放大",
    },
    "remove-background": {
        "en": "remove background", "es": "quitar fondo de una foto",
        "pt": "remover fundo de foto", "id": "hapus background foto",
        "vi": "xóa nền ảnh", "ru": "удалить фон с фото",
        "ja": "画像 背景 透過", "ko": "배경 제거", "zh": "图片去背景",
    },
    "unblur": {
        "en": "unblur image", "es": "mejorar calidad de foto borrosa",
        "pt": "melhorar qualidade de foto desfocada", "id": "memperjelas foto buram",
        "vi": "làm nét ảnh bị mờ", "ru": "улучшить качество фото",
        "ja": "ぼけ 画像 加工", "ko": "흐릿한 사진 보정", "zh": "照片变清晰",
    },
    "restore-old-photo": {
        "en": "restore old photo", "es": "restaurar fotos antiguas",
        "pt": "restaurar fotos antigas", "id": "memperbaiki foto lama",
        "vi": "phục hồi ảnh cũ", "ru": "восстановить старое фото",
        "ja": "古い写真 復元", "ko": "오래된 사진 복원", "zh": "老照片修复",
    },
    "colorize": {
        "en": "colorize black and white photo", "es": "colorear fotos antiguas",
        "pt": "colorir fotos antigas", "id": "mewarnai foto lama",
        "vi": "tô màu ảnh đen trắng", "ru": "раскрасить чб фото",
        "ja": "モノクロ 写真 色付け", "ko": "흑백 사진 색칠", "zh": "黑白照片上色",
    },
    "passport-photo": {
        "en": "passport photo online", "es": "foto carnet online",
        "pt": "foto 3x4 online", "id": "pas foto online",
        "vi": "ảnh thẻ online", "ru": "фото на документы онлайн",
        "ja": "証明写真 作成", "ko": "증명사진 만들기", "zh": "证件照制作",
    },
    "product-photo": {
        "en": "product photo white background", "es": "foto de producto fondo blanco",
        "pt": "foto de produto fundo branco", "id": "foto produk background putih",
        "vi": "ảnh sản phẩm nền trắng", "ru": "фото товара без фона",
        "ja": "商品 写真 背景 透過", "ko": "제품 사진 배경 제거", "zh": "商品图白底",
    },
    "ai-headshot": {
        "en": "ai headshot generator", "es": "foto de perfil profesional ia",
        "pt": "foto profissional ia", "id": "foto profil profesional ai",
        "vi": "ảnh chân dung ai", "ru": "деловой портрет нейросеть",
        "ja": "ai 証明写真", "ko": "ai 증명사진", "zh": "ai证件照",
    },
    "ai-poster": {
        "en": "ai poster generator", "es": "crear posters con ia",
        "pt": "criar poster com ia", "id": "buat poster ai",
        "vi": "tạo poster ai", "ru": "создать постер нейросеть",
        "ja": "ai ポスター 作成", "ko": "ai 포스터 제작", "zh": "ai海报生成",
    },
    "interior-design": {
        "en": "ai interior design", "es": "decorar habitacion con ia",
        "pt": "decorar sala com ia", "id": "desain kamar ai",
        "vi": "thiết kế nội thất ai", "ru": "дизайн интерьера нейросеть",
        "ja": "ai 理想の部屋", "ko": "ai 인테리어 디자인", "zh": "ai室内设计",
    },
    "ai-avatar": {
        "en": "ai avatar generator", "es": "crear avatar ia",
        "pt": "criar avatar ia", "id": "buat avatar ai",
        "vi": "tạo avatar ai", "ru": "аватар нейросеть",
        "ja": "ai アバター 作成", "ko": "ai 프로필 사진", "zh": "ai头像生成",
    },
    "ai-theme-photo": {
        "en": "ai photo generator", "es": "editar foto con ia",
        "pt": "editar foto com ia", "id": "edit foto ai tema",
        "vi": "tạo ảnh ai theo chủ đề", "ru": "нейросеть фото редактор онлайн",
        "ja": "ai 写真 加工", "ko": "ai 사진 편집", "zh": "照片生成特效",
    },
}

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/148.0 Safari/537.36")


def suggest(query, hl):
    url = "https://suggestqueries.google.com/complete/search?" + urllib.parse.urlencode(
        {"client": "firefox", "hl": hl, "ie": "utf-8", "oe": "utf-8", "q": query}
    )
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read().decode("utf-8", "replace")
    data = json.loads(raw)
    return [str(x) for x in (data[1] if len(data) > 1 else [])]


def one(job):
    family, lang, q = job
    got = []
    err = None
    for attempt in range(3):
        try:
            got = list(dict.fromkeys(suggest(q, lang) + suggest(q + " ", lang)))
            err = None
            break
        except Exception as exc:
            err = f"{type(exc).__name__}: {exc}"
            time.sleep(1.5 * (attempt + 1))
    return family, lang, q, got, err


jobs = [(f, l, q) for f, langs in FAMILIES.items() for l, q in langs.items()]
with ThreadPoolExecutor(max_workers=10) as pool:
    results = list(pool.map(one, jobs))

out = {"_meta": {"collected_at": time.strftime("%Y-%m-%d"), "source":
                 "suggestqueries.google.com/complete/search (client=firefox)",
                 "warning": "autocomplete presence is query-existence evidence, not search volume"},
       "families": {}}
for family, lang, q, got, err in results:
    out["families"].setdefault(family, {})[lang] = {"query": q, "suggestions": got, "error": err}

with open(sys.argv[1], "w", encoding="utf-8") as fh:
    json.dump(out, fh, ensure_ascii=False, indent=1)

total = 0
for family, langs in out["families"].items():
    counts = []
    for lang, d in langs.items():
        counts.append(f"{lang}:{len(d['suggestions'])}{'!' if d['error'] else ''}")
        total += len(d["suggestions"])
    print(f"{family:20s} {' '.join(counts)}")
print(f"TOTAL suggestions: {total}")
